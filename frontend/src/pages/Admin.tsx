import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, UserCog } from "lucide-react";

import { PageHeader, Spinner } from "@/components/ui/States";
import { authApi } from "@/lib/api";
import type { Role, User } from "@/lib/types";
import { useAuth } from "@/store/auth";

const ROLES: Role[] = ["admin", "manager", "user"];

export default function Admin() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin";

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => authApi.listUsers(),
    enabled: isAdmin,
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) => authApi.updateRole(id, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });

  if (!isAdmin) {
    return (
      <div className="card mt-6 text-center text-sm text-slate-400">
        You need admin privileges to view this page.
      </div>
    );
  }

  if (isLoading || !users) return <Spinner label="Loading users…" />;

  return (
    <div>
      <PageHeader title="Admin Dashboard" subtitle="Manage users and roles" />

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
