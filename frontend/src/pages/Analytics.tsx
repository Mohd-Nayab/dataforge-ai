import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { NoDataset, PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import { useDataset } from "@/store/dataset";

const COLORS = ["#6366f1", "#a855f7", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#f43f5e", "#8b5cf6"];

export default function Analytics() {
  const { active } = useDataset();

  const { data, isLoading } = useQuery({
    queryKey: ["overview", active?.id],
    queryFn: () => dataApi.overview(active!.id),
    enabled: !!active,
  });

  if (!active) return <NoDataset />;
  if (isLoading || !data) return <Spinner label="Crunching analytics…" />;

  const { kpis, histogram, category_breakdown, correlation } = data;

  return (
    <div>
      <PageHeader title="Analytics Dashboard" subtitle={active.name} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Rows" value={kpis.rows.toLocaleString()} />
        <Kpi label="Columns" value={kpis.columns} />
        <Kpi label="Numeric" value={kpis.numeric_columns} />
        <Kpi label="Categorical" value={kpis.categorical_columns} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {histogram && histogram.bins.length > 0 && (
          <div className="card">
            <h3 className="mb-4 font-semibold">Distribution · {histogram.column}</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={histogram.bins}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="bin" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,23,42,0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                  }}
                />
                <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {category_breakdown && category_breakdown.data.length > 0 && (
          <div className="card">
            <h3 className="mb-4 font-semibold">Breakdown · {category_breakdown.column}</h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={category_breakdown.data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label
                >
                  {category_breakdown.data.map((_e, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,23,42,0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {correlation && correlation.columns.length > 0 && (
        <div className="card mt-6">
          <h3 className="mb-4 font-semibold">Correlation Matrix</h3>
          <CorrelationHeatmap
            columns={correlation.columns}
            matrix={correlation.matrix}
          />
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-50">{value}</p>
    </div>
  );
}

function CorrelationHeatmap({
  columns,
  matrix,
}: {
  columns: string[];
  matrix: { x: string; y: string; value: number }[];
}) {
  const lookup = new Map(matrix.map((m) => [`${m.y}|${m.x}`, m.value]));

  function color(v: number) {
    // Blue (negative) -> neutral -> indigo (positive)
    const intensity = Math.min(1, Math.abs(v));
    if (v >= 0) return `rgba(99,102,241,${0.15 + intensity * 0.75})`;
    return `rgba(244,63,94,${0.15 + intensity * 0.75})`;
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="p-2" />
            {columns.map((c) => (
              <th key={c} className="max-w-[80px] truncate p-2 text-slate-400" title={c}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((row) => (
            <tr key={row}>
              <td className="max-w-[120px] truncate p-2 text-right text-slate-400" title={row}>
                {row}
              </td>
              {columns.map((col) => {
                const v = lookup.get(`${row}|${col}`) ?? 0;
                return (
                  <td
                    key={col}
                    className="h-10 w-14 text-center font-medium text-slate-100"
                    style={{ background: color(v) }}
                  >
                    {v.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
