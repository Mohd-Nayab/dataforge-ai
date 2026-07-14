import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle,
  Database,
  Edit2,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { PageHeader, Spinner } from "@/components/ui/States";
import { databaseApi } from "@/lib/api";
import type {
  AdapterDescriptor,
  ConnectionProfile,
  ConnectionProfilePublic,
  ManagerStatus,
  SchemaObject,
  SupportedDatabase,
} from "@/lib/types";

interface ProfileFormState {
  id?: string;
  name: string;
  type: SupportedDatabase;
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
  authMethod: string;
  options: string;
}

const EMPTY_FORM: ProfileFormState = {
  name: "",
  type: "sqlite",
  host: "",
  port: "",
  username: "",
  password: "",
  database: "",
  ssl: false,
  authMethod: "",
  options: "",
};

function formatType(type: string) {
  const map: Record<string, string> = {
    sqlite: "SQLite",
    postgres: "PostgreSQL",
    mysql: "MySQL",
    mariadb: "MariaDB",
    sqlserver: "SQL Server",
    oracle: "Oracle",
    mongodb: "MongoDB",
    redis: "Redis",
    elasticsearch: "Elasticsearch",
    pinecone: "Pinecone",
    chromadb: "ChromaDB",
    weaviate: "Weaviate",
    qdrant: "Qdrant",
    milvus: "Milvus",
    faiss: "FAISS (local)",
  };
  return map[type] ?? type;
}

export default function ConnectionManager() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProfileFormState>(EMPTY_FORM);
  const [query, setQuery] = useState("SELECT 1");

  const { data: descriptors } = useQuery({
    queryKey: ["database", "supported"],
    queryFn: () => databaseApi.getSupported().then((r) => r.databases),
  });

  const { data: status } = useQuery({
    queryKey: ["database", "status"],
    queryFn: () => databaseApi.getStatus(),
    refetchInterval: 5000,
  });

  const { data: profilesData, isLoading } = useQuery({
    queryKey: ["database", "profiles"],
    queryFn: () => databaseApi.listProfiles(),
  });

  const { data: schema } = useQuery({
    queryKey: ["database", "schema"],
    queryFn: () => databaseApi.discoverSchema(),
    enabled: Boolean(status?.connected),
  });

  const activeProfile = profilesData?.profiles.find((p) => p.id === status?.activeProfileId);

  const switchMutation = useMutation({
    mutationFn: (id: string) => databaseApi.switchTo(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["database"] });
      toast.success(res.message);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? "Switch failed"),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => databaseApi.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["database"] });
      toast.success("Disconnected");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? "Disconnect failed"),
  });

  const testMutation = useMutation({
    mutationFn: ({ id, body }: { id?: string; body?: ProfileFormState }) =>
      databaseApi.testProfile(id, body ? buildBody(body) : undefined),
    onSuccess: (res) => toast[res.ok ? "success" : "error"](res.message),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? "Test failed"),
  });

  const saveMutation = useMutation({
    mutationFn: async (state: ProfileFormState) => {
      const body = buildBody(state);
      if (state.id) return databaseApi.updateProfile(state.id, body);
      return databaseApi.createProfile(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["database", "profiles"] });
      setShowForm(false);
      setForm(EMPTY_FORM);
      toast.success("Profile saved");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? "Save failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => databaseApi.deleteProfile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["database", "profiles"] });
      toast.success("Profile deleted");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? "Delete failed"),
  });

  const queryMutation = useMutation({
    mutationFn: (sql: string) => databaseApi.executeQuery(sql),
    onError: (e: any) => toast.error(e?.response?.data?.error ?? "Query failed"),
  });

  function buildBody(state: ProfileFormState): Partial<ConnectionProfile> {
    const descriptor = descriptors?.find((d) => d.type === state.type);
    return {
      name: state.name,
      type: state.type,
      host: state.host || undefined,
      port: state.port ? Number(state.port) : descriptor?.defaultPort,
      username: state.username || undefined,
      password: state.password || undefined,
      database: state.database || undefined,
      ssl: state.ssl,
      authMethod: state.authMethod || undefined,
      options: state.options ? parseJson(state.options) : undefined,
    } as Partial<ConnectionProfile>;
  }

  function parseJson(raw: string): Record<string, unknown> | undefined {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  function openForm(profile?: ConnectionProfilePublic) {
    if (profile) {
      setForm({
        id: profile.id,
        name: profile.name,
        type: profile.type,
        host: profile.host ?? "",
        port: profile.port?.toString() ?? "",
        username: profile.username ?? "",
        password: "",
        database: profile.database ?? "",
        ssl: profile.ssl ?? false,
        authMethod: profile.authMethod ?? "",
        options: profile.options ? JSON.stringify(profile.options, null, 2) : "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setShowForm(true);
  }

  function requiredFields(descriptor: AdapterDescriptor | undefined) {
    return descriptor?.requiredFields ?? ["database"];
  }

  const currentDescriptor = descriptors?.find((d) => d.type === form.type);
  const fields = requiredFields(currentDescriptor);

  if (isLoading) return <Spinner label="Loading connection profiles…" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connection Manager"
        subtitle="Add, test, and switch between databases without touching code"
      />

      {/* Status */}
      <div className="card grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatusTile
          icon={Database}
          label="Active Database"
          value={activeProfile ? formatType(activeProfile.type) : "None"}
          sub={activeProfile?.name}
          tone={status?.connected ? "ok" : "neutral"}
        />
        <StatusTile
          icon={Server}
          label="Connection"
          value={status?.connected ? "Connected" : "Disconnected"}
          sub={activeProfile?.host ? `${activeProfile.host}:${activeProfile.port}` : undefined}
          tone={status?.connected ? "ok" : "neutral"}
        />
        <StatusTile
          icon={Layers}
          label="Objects Discovered"
          value={schema ? String(schema.objects.length) : "—"}
          sub={schema ? `as of ${new Date(schema.discoveredAt).toLocaleTimeString()}` : undefined}
          tone="neutral"
        />
        <StatusTile
          icon={CheckCircle}
          label="Adapters Available"
          value={String(descriptors?.filter((d) => d.status === "available").length ?? 0)}
          sub={`of ${descriptors?.length ?? 0} supported engines`}
          tone="neutral"
        />
      </div>

      {/* Profiles */}
      <div className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
            <Server className="h-5 w-5 text-brand-400" />
            Saved Connection Profiles
          </h2>
          <button onClick={() => openForm()} className="btn-primary flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add Connection
          </button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-900/80">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Host / Path</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {profilesData?.profiles.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    No saved connections. Click Add Connection to start.
                  </td>
                </tr>
              )}
              {profilesData?.profiles.map((p) => (
                <ProfileRow
                  key={p.id}
                  profile={p}
                  status={status}
                  onSwitch={() => switchMutation.mutate(p.id)}
                  onTest={() => testMutation.mutate({ id: p.id })}
                  onEdit={() => openForm(p)}
                  onDelete={() => deleteMutation.mutate(p.id)}
                  switching={switchMutation.isPending && switchMutation.variables === p.id}
                  testing={testMutation.isPending && testMutation.variables?.id === p.id}
                />
              ))}
            </tbody>
          </table>
        </div>

        {status?.connected && activeProfile && (
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="btn-ghost text-rose-300 hover:text-rose-200"
            >
              Disconnect
            </button>
            <span className="text-xs text-slate-500">
              Connected to <strong className="text-slate-300">{activeProfile.name}</strong>
            </span>
          </div>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="card border border-brand-500/30 bg-slate-950">
          <h3 className="mb-4 text-base font-semibold text-slate-100">
            {form.id ? "Edit Connection" : "New Connection"}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Connection Name">
              <input
                className="input w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Production Postgres"
              />
            </Field>
            <Field label="Database Type">
              <select
                className="input w-full"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as SupportedDatabase })}
              >
                {descriptors?.map((d) => (
                  <option key={d.type} value={d.type}>
                    {d.label} {d.status === "planned" ? "(coming soon)" : ""}
                  </option>
                ))}
              </select>
            </Field>
            {fields.includes("host") && (
              <Field label="Host">
                <input
                  className="input w-full"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="localhost"
                />
              </Field>
            )}
            {fields.includes("port") && (
              <Field label="Port">
                <input
                  className="input w-full"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  placeholder={currentDescriptor?.defaultPort?.toString() ?? "5432"}
                />
              </Field>
            )}
            {fields.includes("database") && (
              <Field label={form.type === "sqlite" || form.type === "faiss" ? "File / Path" : "Database"}>
                <input
                  className="input w-full"
                  value={form.database}
                  onChange={(e) => setForm({ ...form, database: e.target.value })}
                  placeholder={form.type === "sqlite" ? ":memory: or data.db" : "mydb"}
                />
              </Field>
            )}
            {fields.includes("username") && (
              <Field label="Username">
                <input
                  className="input w-full"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </Field>
            )}
            {fields.includes("password") && (
              <Field label="Password">
                <input
                  type="password"
                  className="input w-full"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                {form.id && (
                  <p className="mt-1 text-xs text-slate-500">
                    Leave blank to keep the existing password.
                  </p>
                )}
              </Field>
            )}
            {fields.includes("options") && (
              <Field label="Advanced Options (JSON / connection string)">
                <textarea
                  className="input w-full font-mono text-xs"
                  rows={3}
                  value={form.options}
                  onChange={(e) => setForm({ ...form, options: e.target.value })}
                  placeholder='{"connectionString":"postgresql://..."}'
                />
              </Field>
            )}
            <div className="flex items-center gap-2 md:col-span-2">
              <input
                id="ssl"
                type="checkbox"
                checked={form.ssl}
                onChange={(e) => setForm({ ...form, ssl: e.target.checked })}
              />
              <label htmlFor="ssl" className="text-sm text-slate-300">
                Use SSL / TLS
              </label>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending || !form.name}
              className="btn-primary"
            >
              {saveMutation.isPending ? "Saving…" : "Save Profile"}
            </button>
            <button
              onClick={() => testMutation.mutate({ body: form })}
              disabled={testMutation.isPending}
              className="btn-ghost flex items-center gap-2"
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Test Connection
            </button>
            <button onClick={() => setShowForm(false)} className="btn-ghost ml-auto">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Schema explorer */}
      {status?.connected && schema && (
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-100">
            <Search className="h-5 w-5 text-brand-400" />
            Schema Explorer — {activeProfile?.name}
          </h2>
          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-800">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-900/80">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Object</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Columns / Fields</th>
                  <th className="px-4 py-3">Rows</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {schema.objects.map((obj) => (
                  <tr key={obj.name} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2 font-medium text-slate-200">{obj.name}</td>
                    <td className="px-4 py-2 text-slate-400">{obj.type}</td>
                    <td className="px-4 py-2 text-slate-400">
                      {obj.columns?.map((c) => `${c.name} (${c.dataType})`).join(", ") ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-400">{obj.rowCount ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Query runner (only for SQL-capable active connections) */}
      {status?.connected && activeProfile && (
        <div className="card">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-100">
            <RefreshCw className="h-5 w-5 text-brand-400" />
            Query Runner
          </h2>
          <textarea
            className="input w-full font-mono text-sm"
            rows={4}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            onClick={() => queryMutation.mutate(query)}
            disabled={queryMutation.isPending}
            className="btn-primary mt-3"
          >
            {queryMutation.isPending ? "Running…" : "Run Query"}
          </button>
          {queryMutation.data && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-900/80">
                  <tr className="text-left text-xs font-semibold uppercase text-slate-500">
                    {(queryMutation.data.fields?.length
                      ? queryMutation.data.fields
                      : queryMutation.data.rows[0]
                        ? Object.keys(queryMutation.data.rows[0])
                        : []
                    ).map((f) => (
                      <th key={f} className="px-4 py-2">
                        {f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {queryMutation.data.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-800/30">
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-4 py-2 text-slate-300">
                          {typeof v === "object" ? JSON.stringify(v) : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!status?.connected && (
        <div className="glass rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              No active database connection. Add a connection profile and click{" "}
              <strong>Switch</strong> to start exploring schemas and running queries.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone: "ok" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className={`text-lg font-semibold ${tone === "ok" ? "text-emerald-400" : "text-slate-200"}`}>
        {value}
      </div>
      {sub && <p className="mt-1 truncate text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function ProfileRow({
  profile,
  status,
  onSwitch,
  onTest,
  onEdit,
  onDelete,
  switching,
  testing,
}: {
  profile: ConnectionProfilePublic;
  status?: ManagerStatus;
  onSwitch: () => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  switching: boolean;
  testing: boolean;
}) {
  const isActive = status?.activeProfileId === profile.id;
  return (
    <tr className={isActive ? "bg-brand-600/10" : "hover:bg-slate-800/30"}>
      <td className="px-4 py-3 font-medium text-slate-100">
        {profile.name}
        {isActive && (
          <span className="ml-2 inline-flex items-center rounded-full bg-brand-600/20 px-2 py-0.5 text-[10px] font-medium text-brand-300">
            ACTIVE
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-300">{formatType(profile.type)}</td>
      <td className="px-4 py-3 text-slate-400">
        {profile.host ? `${profile.host}${profile.port ? `:${profile.port}` : ""}` : profile.database ?? "—"}
      </td>
      <td className="px-4 py-3 text-slate-400">
        {isActive ? (status?.connected ? "Connected" : "Connecting") : "Idle"}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onSwitch}
            disabled={switching}
            className="btn-primary py-1.5 text-xs disabled:opacity-50"
          >
            {switching ? "Switching…" : isActive ? "Active" : "Switch"}
          </button>
          <button onClick={onTest} disabled={testing} className="btn-ghost p-2 text-slate-400" title="Test">
            <RefreshCw className={`h-4 w-4 ${testing ? "animate-spin" : ""}`} />
          </button>
          <button onClick={onEdit} className="btn-ghost p-2 text-slate-400" title="Edit">
            <Edit2 className="h-4 w-4" />
          </button>
          <button onClick={onDelete} className="btn-ghost p-2 text-rose-400 hover:text-rose-300" title="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
