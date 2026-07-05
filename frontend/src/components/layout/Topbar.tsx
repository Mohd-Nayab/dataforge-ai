import { Database, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/store/auth";
import { useDataset } from "@/store/dataset";

export default function Topbar() {
  const { user, logout } = useAuth();
  const { active } = useDataset();
  const navigate = useNavigate();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/40 px-4 backdrop-blur-xl lg:px-6">
      <div className="flex items-center gap-3">
        {active ? (
          <div className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-1.5 text-sm">
            <Database className="h-4 w-4 text-brand-400" />
            <span className="font-medium text-slate-100">{active.name}</span>
            <span className="text-slate-500">
              {active.rows.toLocaleString()} rows · {active.columns} cols
            </span>
          </div>
        ) : (
          <span className="text-sm text-slate-500">No dataset selected</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-slate-100">{user?.name}</p>
          <p className="text-[11px] capitalize text-slate-500">{user?.role}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-fuchsia-500 text-sm font-semibold text-white">
          {user?.name?.[0]?.toUpperCase() ?? "U"}
        </div>
        <button
          className="btn-ghost px-2.5 py-2"
          title="Log out"
          onClick={() => {
            logout();
            navigate("/login");
          }}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
