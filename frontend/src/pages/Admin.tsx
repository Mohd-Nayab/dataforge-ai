import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Shield, UserCog } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { PageHeader, Spinner } from "@/components/ui/States";
import { authApi } from "@/lib/api";
import type { DatabaseType, Role, User } from "@/lib/types";
import { useAuth } from "@/store/auth";

const ROLES: Role[] = ["admin", "manager", "user"];

const DB_LABELS: Record<DatabaseType, string> = {
  json: "JSON File (default)",
  sqlite: "SQLite",
  postgres: "PostgreSQL",
  mongodb: "MongoDB",
};

const DB_PLACEHOLDERS: Record<DatabaseType, string> = {
  json: "Leave empty for default data directory",
  sqlite: "Leave empty for default data directory",
  postgres: "postgresql://user:pass@host:5432/dbname",
  mongodb: "mongodb+srv://user:pass@cluster.mongodb.net/dbname",
};

export default function Admin() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";

  const { data: users, isLoading, isError: usersError } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => authApi.listUsers(),
    enabled: isAdmin,
  });

  const { data: dbConfig } = useQuery({
    queryKey: ["admin", "database"],
    queryFn: () => authApi.getDatabaseConfig(),
    enabled: isAdmin,
  });

  const [selectedDb, setSelectedDb] = useState<DatabaseType>("json");
  const [dbUrl, setDbUrl] = useState("");
  const [migrateUsers, setMigrateUsers] = useState(true);

  useEffect(() => {
    if (dbConfig) setSelectedDb(dbConfig.type);
  }, [dbConfig]);

  const requiresUrl = selectedDb === "postgres" || selectedDb === "mongodb";
  const sameType = dbConfig?.type === selectedDb;
  const sameUrl =
    (dbUrl.trim() || "") === ((dbConfig?.url ?? "").trim() || "");
  // For json/sqlite, empty URL means default path — treat as same target when type matches.
  // For postgres/mongodb, allow switch when URL differs even if type is unchanged.
  const isCurrent = sameType && (requiresUrl ? sameUrl || dbUrl.trim().length === 0 : true);
  const canSwitch = !isCurrent && (!requiresUrl || dbUrl.trim().length > 0);

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => authApi.updateRole(id, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? "Failed to update role"),
  });

  const switchDb = useMutation({
    mutationFn: () => authApi.switchDatabase(selectedDb, dbUrl.trim(), { migrate: migrateUsers }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "database"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setDbUrl("");
      toast.success(res.message);
    },
    onError: (e: any) => {
      const msg =
        e?.response?.data?.error ??
        e?.response?.data?.detail ??
        e?.message ??
        "Failed to switch database";
      toast.error(typeof msg === "string" ? msg : "Failed to switch database");
    },
  });

  if (!isAdmin) {
    return (
      <div className="card mt-6 text-center text-sm text-slate-400">
        You need admin privileges to view this page.
      </div>
    );
  }

  if (isLoading) return <Spinner label="Loading users…" />;
  if (usersError || !users) {
    return (
      <div className="card mt-6 text-center text-sm text-rose-400">
        Failed to load users. Try logging out and back in, then refresh.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Admin Dashboard" subtitle="Manage users, roles, and database" />

      <div className="card">
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-5 w-5 text-brand-400" />
          <h2 className="text-base font-semibold text-slate-100">Database Connection</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Database</label>
            <select
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value as DatabaseType)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              {dbConfig?.available.map((type) => (
                <option key={type} value={type}>
                  {DB_LABELS[type]}
                </option>
              )) ??
                Object.entries(DB_LABELS).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Connection URL / Path
            </label>
            <input
              type="text"
              value={dbUrl}
              onChange={(e) => setDbUrl(e.target.value)}
              placeholder={DB_PLACEHOLDERS[selectedDb]}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
            />
          </div>
        </div>

        <label className="mt-4 flex items-start gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={migrateUsers}
            onChange={(e) => setMigrateUsers(e.target.checked)}
          />
          <span>
            Migrate existing users and dataset metadata into the new database
            <span className="block text-slate-500">
              Recommended. Uncheck only if you intentionally want an empty target store.
            </span>
          </span>
        </label>

        {!migrateUsers && !isCurrent && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Warning: switching without migration can leave the target database empty. Existing
            sessions may fail until users re-register or you switch back.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => {
              const target = DB_LABELS[selectedDb];
              const ok = window.confirm(
                migrateUsers
                  ? `Switch to ${target} and migrate users + dataset metadata?`
                  : `Switch to ${target} WITHOUT migration? The target may be empty and logins can break.`
              );
              if (ok) switchDb.mutate();
            }}
            disabled={switchDb.isPending || !canSwitch}
            className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {switchDb.isPending ? "Switching…" : "Switch Database"}
          </button>
          {dbConfig && (
            <span className="text-xs text-slate-500">
              Current: <strong className="text-slate-300">{DB_LABELS[dbConfig.type]}</strong>
            </span>
          )}
        </div>

        {isCurrent && (
          <p className="mt-3 text-xs text-slate-500">
            Already using <strong className="text-slate-300">{DB_LABELS[selectedDb]}</strong>.
            Choose another option (e.g. SQLite / PostgreSQL / MongoDB) to enable Switch Database.
          </p>
        )}
        {!isCurrent && requiresUrl && dbUrl.trim().length === 0 && (
          <p className="mt-3 text-xs text-amber-400">
            Enter a connection URL to switch to {DB_LABELS[selectedDb]}. Without a URL the button
            stays disabled.
          </p>
        )}
        {!isCurrent && !requiresUrl && (
          <p className="mt-3 text-xs text-slate-500">
            Ready to switch to {DB_LABELS[selectedDb]}. Click <strong>Switch Database</strong> and
            confirm.
          </p>
        )}
        {switchDb.isError && (
          <p className="mt-3 text-xs text-red-400">
            {(switchDb.error as { response?: { data?: { error?: string } } })?.response?.data
              ?.error ??
              (switchDb.error as Error)?.message ??
              "Failed to switch database"}
          </p>
        )}
        {switchDb.isSuccess && (
          <p className="mt-3 text-xs text-emerald-400">
            {(switchDb.data as { message?: string } | undefined)?.message ??
              "Database switched successfully."}{" "}
            Selection is saved and kept after backend restart.
          </p>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-900/80">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {users.map((u: User) => (
                <tr key={u.id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3 font-medium text-slate-100">
                    <div className="flex items-center gap-2">
                      {u.name}
                      {u.role === "admin" && (
                        <Shield className="h-3.5 w-3.5 text-brand-400" aria-label="Admin" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{u.email}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => updateRole.mutate({ id: u.id, role: e.target.value as Role })}
                      disabled={u.id === user?.id || updateRole.isPending}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 disabled:opacity-50"
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
