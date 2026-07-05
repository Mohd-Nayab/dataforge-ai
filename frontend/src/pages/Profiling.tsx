import { useQuery } from "@tanstack/react-query";
import { Copy, Database, HardDrive, Percent, Rows3 } from "lucide-react";

import ExportMenu from "@/components/ui/ExportMenu";
import { NoDataset, PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { ColumnStat } from "@/lib/types";
import { useDataset } from "@/store/dataset";

export default function Profiling() {
  const { active } = useDataset();

  const { data, isLoading } = useQuery({
    queryKey: ["stats", active?.id],
    queryFn: () => dataApi.stats(active!.id),
    enabled: !!active,
  });

  if (!active) return <NoDataset />;
  if (isLoading || !data) return <Spinner label="Profiling dataset…" />;

  return (
    <div>
      <PageHeader title="Data Profiling" subtitle={active.name}>
        <ExportMenu datasetId={active.id} />
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi icon={Rows3} label="Rows" value={data.rows.toLocaleString()} />
        <Kpi icon={Database} label="Columns" value={data.columns} />
        <Kpi icon={Copy} label="Duplicates" value={data.duplicate_rows.toLocaleString()} />
        <Kpi icon={Percent} label="Missing" value={`${data.missing_pct}%`} />
        <Kpi icon={HardDrive} label="Memory" value={`${data.memory_kb} KB`} />
      </div>

      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-900/80">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Column</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Missing</th>
                <th className="px-4 py-3">Unique</th>
                <th className="px-4 py-3">Min / Top</th>
                <th className="px-4 py-3">Mean</th>
                <th className="px-4 py-3">Median</th>
                <th className="px-4 py-3">Max</th>
                <th className="px-4 py-3">Std</th>
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
    </div>
  );
}

function ColumnRow({ col }: { col: ColumnStat }) {
  const isNumeric = col.mean !== undefined && col.mean !== null;
  return (
    <tr className="border-t border-white/5 hover:bg-white/5">
      <td className="px-4 py-3 font-medium text-slate-100">{col.name}</td>
      <td className="px-4 py-3">
        <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-slate-400">
          {col.dtype}
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
      <td className="px-4 py-3 text-slate-300">
        {isNumeric ? fmt(col.min) : truncate(col.top)}
      </td>
      <td className="px-4 py-3 text-slate-300">{isNumeric ? fmt(col.mean) : "—"}</td>
      <td className="px-4 py-3 text-slate-300">{isNumeric ? fmt(col.median) : "—"}</td>
      <td className="px-4 py-3 text-slate-300">{isNumeric ? fmt(col.max) : "—"}</td>
      <td className="px-4 py-3 text-slate-300">{isNumeric ? fmt(col.std) : "—"}</td>
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
