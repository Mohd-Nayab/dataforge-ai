import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Save, User } from "lucide-react";
import toast from "react-hot-toast";

import { PageHeader, Spinner } from "@/components/ui/States";
import { authApi } from "@/lib/api";
import { useAuth } from "@/store/auth";

export default function Profile() {
  const { user, setUser } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(user?.name ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");

  const updateProfile = useMutation({
    mutationFn: () => authApi.updateProfile(name),
    onSuccess: (updated) => {
      setUser(updated);
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error ?? "Failed to update profile"),
  });

  const changePassword = useMutation({
    mutationFn: () => authApi.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Password changed successfully");
    },
    onError: (err: any) => {
      setPasswordMessage(err?.response?.data?.error ?? "Failed to change password");
    },
  });

  if (!user) return <Spinner label="Loading profile…" />;

  const canChangePassword =
    newPassword.length >= 8 && newPassword === confirmPassword && currentPassword.length > 0;

  return (
    <div>
      <PageHeader title="Profile" subtitle="Manage your account" />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-4 flex items-center gap-2 font-semibold">
            <User className="h-4 w-4 text-brand-400" />
            Account details
          </h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input w-full"
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Email</label>
              <input
                type="email"
                value={user.email}
                disabled
                className="input w-full cursor-not-allowed opacity-60"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Role</label>
              <span className="inline-flex rounded-full bg-brand-600/20 px-3 py-1 text-xs font-medium text-brand-300">
                {user.role}
              </span>
            </div>
            <div className="pt-2">
              <button
                className="btn-primary"
                disabled={name === user.name || name.length < 1 || updateProfile.isPending}
                onClick={() => updateProfile.mutate()}
              >
                <Save className="h-4 w-4" /> Save changes
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="mb-4 font-semibold">Change password</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input w-full"
              />
              <p className="mt-1 text-xs text-slate-500">Minimum 8 characters</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input w-full"
              />
            </div>
            {passwordMessage && (
              <p className="text-xs text-slate-300">{passwordMessage}</p>
            )}
            <div className="pt-2">
              <button
                className="btn-primary"
                disabled={!canChangePassword || changePassword.isPending}
                onClick={() => changePassword.mutate()}
              >
                Change password
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
