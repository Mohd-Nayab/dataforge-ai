import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bot,
  Database,
  FileSpreadsheet,
  Sparkles,
  Upload as UploadIcon,
  Wand2,
} from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import { useAuth } from "@/store/auth";

const QUICK = [
  { to: "/upload", label: "Upload Data", desc: "CSV, Excel, JSON & more", icon: UploadIcon },
  { to: "/cleaning", label: "Cleaning Studio", desc: "One-click data cleaning", icon: Wand2 },
  { to: "/analytics", label: "Analytics", desc: "Charts & correlations", icon: BarChart3 },
  { to: "/chat", label: "AI Assistant", desc: "Ask questions in English", icon: Bot },
];

export default function Dashboard() {
  const { user } = useAuth();
  const { data: datasets } = useQuery({
    queryKey: ["datasets"],
    queryFn: dataApi.list,
  });

  const totalRows = (datasets ?? []).reduce((s, d) => s + d.rows, 0);

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${user?.name?.split(" ")[0] ?? "there"} 👋`}
        subtitle="Your AI-powered data workspace."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={Database} label="Datasets" value={(datasets ?? []).length} />
        <KpiCard icon={FileSpreadsheet} label="Total Rows" value={totalRows.toLocaleString()} />
        <KpiCard
          icon={BarChart3}
          label="Columns"
          value={(datasets ?? []).reduce((s, d) => s + d.columns, 0)}
        />
        <KpiCard icon={Sparkles} label="Workspace" value={user?.role ?? "user"} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Quick actions
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK.map(({ to, label, desc, icon: Icon }) => (
          <Link key={to} to={to} className="card glass-hover group">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600/20 text-brand-300 transition group-hover:bg-brand-600/30">
              <Icon className="h-5 w-5" />
            </div>
            <p className="font-semibold text-slate-100">{label}</p>
            <p className="text-sm text-slate-400">{desc}</p>
          </Link>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Recent datasets
      </h2>
      <div className="card">
        {(datasets ?? []).length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">
            No datasets yet.{" "}
            <Link to="/upload" className="text-brand-400 hover:text-brand-300">
              Upload your first file
            </Link>
            .
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {(datasets ?? []).slice(0, 6).map((d) => (
              <Link
                key={d.id}
                to="/preview"
                className="flex items-center justify-between py-3 transition hover:bg-white/5"
              >
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-5 w-5 text-brand-400" />
                  <div>
                    <p className="text-sm font-medium text-slate-100">{d.name}</p>
                    <p className="text-xs text-slate-500">{d.filename}</p>
                  </div>
                </div>
                <span className="text-xs text-slate-500">
                  {d.rows.toLocaleString()} rows · {d.columns} cols
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="card glass-hover">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </span>
        <Icon className="h-4 w-4 text-brand-400" />
      </div>
      <p className="mt-2 text-2xl font-bold capitalize text-slate-50">{value}</p>
    </div>
  );
}
