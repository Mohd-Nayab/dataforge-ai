import { useQuery } from "@tanstack/react-query";
import {
  Copy,
  Database,
  Gauge,
  HardDrive,
  Percent,
  Rows3,
  Sparkles,
} from "lucide-react";

import ExportMenu from "@/components/ui/ExportMenu";
import { NoDataset, PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { EnterpriseColumnStat } from "@/lib/types";
import { useDataset } from "@/store/dataset";

export default function Profiling() {
  const { active } = useDataset();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["enterprise-profile", active?.id],
    queryFn: () => dataApi.enterpriseProfile(active!.id),
    enabled: !!active,
  });

  if (!active) return <NoDataset />;
  if (isLoading) return <Spinner label="Running enterprise profile…" />;
  if (isError || !data)
    return (
      <div className="glass py-20 text-center">
        <p className="text-lg font-semibold text-rose-400">Failed to load profile</p>
        <p className="mt-1 text-sm text-slate-400">Try refreshing the page.</p>
      </div>
    );

  const scores = data.quality_scores;

  return (
    <div>
      <PageHeader title="Enterprise Profiling" subtitle={active.name}>
        <ExportMenu datasetId={active.id} />
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Kpi icon={Rows3} label="Rows" value={data.rows.toLocaleString()} />
        <Kpi icon={Database} label="Columns" value={data.columns} />
        <Kpi icon={Copy} label="Duplicates" value={`${data.duplicate_rows.toLocaleString()} (${data.duplicate_pct}%)`} />
        <Kpi icon={Percent} label="Missing" value={`${data.missing_pct}%`} />
        <Kpi icon={HardDrive} label="Memory" value={`${data.memory_mb} MB`} />
        <Kpi icon={Gauge} label="Quality" value={`${scores.overall}/100`} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <ScoreKpi label="Completeness" value={scores.completeness} />
        <ScoreKpi label="Consistency" value={scores.consistency} />
        <ScoreKpi label="Validity" value={scores.validity} />
        <ScoreKpi label="Accuracy" value={scores.accuracy} />
        <ScoreKpi label="Uniqueness" value={scores.uniqueness} />
        <ScoreKpi label="Integrity" value={scores.integrity} />
      </div>

      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-900/80">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Column</th>
                <th className="px-4 py-3">Semantic Type</th>
                <th className="px-4 py-3">Pandas Type</th>
                <th className="px-4 py-3">Missing</th>
                <th className="px-4 py-3">Unique</th>
                <th className="px-4 py-3">Entropy</th>
                <th className="px-4 py-3">Min / Top</th>
                <th className="px-4 py-3">Mean</th>
                <th className="px-4 py-3">Median</th>
                <th className="px-4 py-3">Max</th>
                <th className="px-4 py-3">Std</th>
                <th className="px-4 py-3">Outliers</th>
              </tr>
            </thead>
            <tbody>
              {data.columns_detail.map((c) => (
                <ColumnRow key={c.name} col={c} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {Object.keys(data.correlation_matrix).length > 0 && (
        <div className="card mt-6">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Correlation Matrix (numeric columns)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-slate-900/60">
                <tr>
                  <th className="px-2 py-1 text-left text-slate-500">Column</th>
                  {Object.keys(data.correlation_matrix).map((col) => (
                    <th key={col} className="px-2 py-1 text-left text-slate-500">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.correlation_matrix).map(([row, cols]) => (
                  <tr key={row} className="border-t border-white/5">
                    <td className="px-2 py-1 font-medium text-slate-300">{row}</td>
                    {Object.keys(data.correlation_matrix).map((col) => (
                      <td key={col} className="px-2 py-1 text-slate-300">
                        {fmt(cols[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ColumnRow({ col }: { col: EnterpriseColumnStat }) {
  const isNumeric = col.mean !== undefined && col.mean !== null;
  return (
    <tr className="border-t border-white/5 hover:bg-white/5">
      <td className="px-4 py-3 font-medium text-slate-100">{col.name}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-brand-400" />
          <span className="rounded-md bg-brand-500/10 px-2 py-0.5 text-xs text-brand-300">
            {col.semantic_type} ({Math.round(col.semantic_confidence * 100)}%)
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-slate-400">
          {col.pandas_dtype}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full ${col.missing_pct > 30 ? "bg-rose-500" : "bg-amber-400"}`}
              style={{ width: `${Math.min(100, col.missing_pct)}%` }}
            />
          </div>
          <span className="text-xs text-slate-400">
            {col.missing} ({col.missing_pct}%)
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-slate-300">{col.unique.toLocaleString()}</td>
      <td className="px-4 py-3 text-slate-300">{col.entropy ?? "—"}</td>
      <td className="px-4 py-3 text-slate-300">
        {isNumeric ? fmt(col.min) : truncate(col.top)}
      </td>
      <td className="px-4 py-3 text-slate-300">{isNumeric ? fmt(col.mean) : "—"}</td>
      <td className="px-4 py-3 text-slate-300">{isNumeric ? fmt(col.median) : "—"}</td>
      <td className="px-4 py-3 text-slate-300">{isNumeric ? fmt(col.max) : "—"}</td>
      <td className="px-4 py-3 text-slate-300">{isNumeric ? fmt(col.std) : "—"}</td>
      <td className="px-4 py-3 text-slate-300">{col.outlier_count_zscore ?? "—"}</td>
    </tr>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </span>
        <Icon className="h-4 w-4 text-brand-400" />
      </div>
      <p className="mt-2 text-xl font-bold text-slate-50">{value}</p>
    </div>
  );
}

function ScoreKpi({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? "bg-emerald-500" : value >= 50 ? "bg-amber-400" : "bg-rose-500";
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-2">
        <p className="text-xl font-bold text-slate-50">{value}</p>
        <div className="mb-1 h-2 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
        </div>
      </div>
    </div>
  );
}

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

function truncate(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = String(v);
  return s.length > 24 ? `${s.slice(0, 24)}…` : s;
}
