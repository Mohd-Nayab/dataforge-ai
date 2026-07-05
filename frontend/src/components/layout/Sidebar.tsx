import {
  BarChart3,
  Bot,
  Brain,
  Database,
  FileText,
  LayoutDashboard,
  ScanSearch,
  Sparkles,
  Table2,
  Terminal,
  TrendingUp,
  Upload as UploadIcon,
  User,
  UserCog,
  Wand2,
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { cn } from "@/lib/cn";
import type { Role } from "@/lib/types";
import { useAuth } from "@/store/auth";

const NAV: { to: string; label: string; icon: React.ComponentType<{ className?: string }>; end?: boolean; role?: Role }[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/upload", label: "Upload", icon: UploadIcon },
  { to: "/datasets", label: "Datasets", icon: Database },
  { to: "/preview", label: "Data Preview", icon: Table2 },
  { to: "/profiling", label: "Profiling", icon: ScanSearch },
  { to: "/cleaning", label: "Cleaning Studio", icon: Wand2 },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/ml", label: "ML Studio", icon: Brain },
  { to: "/sql", label: "SQL Workspace", icon: Terminal },
  { to: "/report", label: "Report Builder", icon: FileText },
  { to: "/forecast", label: "Forecasting", icon: TrendingUp },
  { to: "/chat", label: "AI Chat", icon: Bot },
  { to: "/profile", label: "Profile", icon: User },
  { to: "/admin", label: "Admin", icon: UserCog, role: "admin" },
];

export default function Sidebar() {
  const { user } = useAuth();
  const visibleNav = NAV.filter((item) => !item.role || item.role === user?.role);

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-slate-950/60 p-4 lg:flex">
      <div className="mb-8 flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-fuchsia-500 shadow-glow">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold tracking-tight">DataForge AI</p>
          <p className="text-[11px] text-slate-400">Data Intelligence</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {visibleNav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-brand-600/20 text-white ring-1 ring-brand-500/40"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
              )
            }
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="glass mt-4 p-3 text-xs text-slate-400">
        <p className="font-semibold text-slate-200">Phase 1 · Core</p>
        <p className="mt-1 leading-relaxed">
          ML, Forecasting, SQL & Reports arrive in the next phase.
        </p>
      </div>
    </aside>
  );
}
