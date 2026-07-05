import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Database, Download, FileText, HardDrive, Info, Percent, Rows3, Shield, Table2, XCircle } from "lucide-react";

import { NoDataset, PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { ReportIssue, ReportResponse } from "@/lib/types";
import { useDataset } from "@/store/dataset";

function severityBadge(severity: ReportIssue["severity"]) {
  const styles = {
    success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    info: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    error: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  const icons = {
    success: CheckCircle2,
    info: Info,
    warning: AlertTriangle,
    error: XCircle,
  };
  const Icon = icons[severity] ?? Info;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${styles[severity]}`}>
      <Icon className="h-3.5 w-3.5" />
      {severity}
    </span>
  );
}

export default function Report() {
  const { active } = useDataset();

  const { data, isLoading } = useQuery<ReportResponse>({
    queryKey: ["report", active?.id],
    queryFn: () => dataApi.getReport(active!.id),
    enabled: !!active,
  });

  if (!active) return <NoDataset />;
  if (isLoading || !data) return <Spinner label="Building report…" />;

  const s = data.summary;

  return (
    <div>
      <PageHeader title="Report Builder" subtitle={data.dataset.name}>
        <button
          onClick={() => dataApi.downloadReport(active.id)}
          className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
        >
          <Download className="mr-2 h-4 w-4" />
          Download HTML
        </button>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
        <Kpi icon={Shield} label="Quality score" value={`${s.quality_score}/100`} />
        <Kpi icon={Rows3} label="Rows" value={s.rows.toLocaleString()} />
        <Kpi icon={Table2} label="Columns" value={s.columns} />
        <Kpi icon={FileText} label="Duplicates" value={s.duplicate_rows.toLocaleString()} />
        <Kpi icon={Percent} label="Missing" value={`${s.missing_pct}%`} />
        <Kpi icon={Database} label="Numeric cols" value={s.numeric_columns} />
        <Kpi icon={Database} label="Categorical cols" value={s.categorical_columns} />
        <Kpi icon={HardDrive} label="Memory" value={`${s.memory_kb} KB`} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className="glass overflow-hidden lg:col-span-2">
          <div className="border-b border-slate-800 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-100">Columns</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-900/80">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Missing</th>
                  <th className="px-4 py-3">Unique</th>
                  <th className="px-4 py-3">Mean / Top</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.columns.map((col) => (
                  <tr key={col.name} className="hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-medium text-slate-200">{col.name}</td>
                    <td className="px-4 py-3 text-slate-400">{col.dtype}</td>
                    <td className="px-4 py-3 text-slate-400">{col.missing} ({col.missing_pct}%)</td>
                    <td className="px-4 py-3 text-slate-400">{col.unique}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {col.mean != null ? col.mean : col.top != null ? String(col.top) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="glass overflow-hidden">
          <div className="border-b border-slate-800 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-100">Issues</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-900/80">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Column</th>
                  <th className="px-4 py-3">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {data.issues.map((issue, i) => (
                  <tr key={i} className="hover:bg-slate-800/30">
                    <td className="px-4 py-3">{severityBadge(issue.severity)}</td>
                    <td className="px-4 py-3 text-slate-400">{issue.column ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-300">{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-800 px-5 py-2 text-xs text-slate-500">
            Generated {new Date(data.generated_at).toLocaleString()}
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="glass flex items-center gap-3 rounded-xl p-4">
      <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-400">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div className="text-lg font-semibold text-slate-100">{value}</div>
      </div>
    </div>
  );
}
