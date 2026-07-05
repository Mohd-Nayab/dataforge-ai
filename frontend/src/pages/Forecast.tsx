import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { NoDataset, PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { ColumnInfo, ForecastPoint, ForecastResponse } from "@/lib/types";
import { useDataset } from "@/store/dataset";

const METHODS = [
  { value: "linear", label: "Linear trend" },
  { value: "moving_average", label: "Moving average" },
  { value: "seasonal_naive", label: "Seasonal naive" },
];

export default function Forecast() {
  const { active } = useDataset();
  const [dateCol, setDateCol] = useState("");
  const [targetCol, setTargetCol] = useState("");
  const [method, setMethod] = useState("linear");
  const [horizon, setHorizon] = useState(7);
  const [result, setResult] = useState<ForecastResponse | null>(null);

  const { data: columns } = useQuery({
    queryKey: ["preview", active?.id, "columns"],
    queryFn: () => dataApi.preview(active!.id, { page: 1, page_size: 1 }).then((r) => r.columns),
    enabled: !!active,
  });

  const forecastMutation = useMutation({
    mutationFn: () =>
      dataApi.forecast(active!.id, {
        date_col: dateCol || undefined,
        target_col: targetCol || undefined,
        method: method as "linear" | "moving_average" | "seasonal_naive",
        horizon,
      }),
    onSuccess: (res) => setResult(res),
  });

  if (!active) return <NoDataset />;
  if (!columns) return <Spinner label="Loading columns…" />;

  const dateColumns = columns.filter((c) => c.dtype === "datetime" || /date|time/i.test(c.name));
  const numericColumns = columns.filter((c) => c.dtype === "number");

  useEffect(() => {
    if (!dateCol && dateColumns.length === 1) {
      setDateCol(dateColumns[0].name);
    }
  }, [dateCol, dateColumns]);

  const chartData = result
    ? [
        ...result.historical.map((p: ForecastPoint) => ({ date: p.date, historical: p.value, forecast: null as number | null })),
        ...result.forecast.map((p: ForecastPoint) => ({ date: p.date, historical: null as number | null, forecast: p.value })),
      ]
    : [];

  const lastHistoricalDate = result && result.historical.length ? result.historical[result.historical.length - 1].date : null;

  return (
    <div>
      <PageHeader title="Forecasting" subtitle={active.name} />

      <div className="mb-6 grid grid-cols-1 gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4 md:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Date column</label>
          <select
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            value={dateCol}
            onChange={(e) => setDateCol(e.target.value)}
          >
            <option value="">Auto-detect</option>
            {dateColumns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Target (optional)</label>
          <select
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            value={targetCol}
            onChange={(e) => setTargetCol(e.target.value)}
          >
            <option value="">Count rows</option>
            {numericColumns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Method</label>
          <select
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-400">Horizon (days)</label>
          <input
            type="number"
            min={1}
            max={90}
            value={horizon}
            onChange={(e) => setHorizon(Math.max(1, Math.min(90, parseInt(e.target.value || "1", 10))))}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          />
        </div>

        <div className="flex items-end">
          <button
            onClick={() => forecastMutation.mutate()}
            disabled={forecastMutation.isPending}
            className="inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {forecastMutation.isPending ? "Forecasting…" : "Run forecast"}
          </button>
        </div>
      </div>

      {result && (
        <>
          <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="mb-4 text-sm font-semibold text-slate-100">
              {result.target_col ? `${result.target_col} over ${result.date_col}` : `Daily count by ${result.date_col}`} — {result.method}
            </h3>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickFormatter={(v) => new Date(v).toLocaleDateString()} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,23,42,0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                  }}
                  labelFormatter={(v) => new Date(v).toLocaleDateString()}
                />
                <Line type="monotone" dataKey="historical" stroke="#6366f1" strokeWidth={2} dot={false} name="Historical" connectNulls={false} />
                <Line type="monotone" dataKey="forecast" stroke="#f59e0b" strokeWidth={2} dot={false} name="Forecast" connectNulls={false} />
                {lastHistoricalDate && <ReferenceLine x={lastHistoricalDate} stroke="#94a3b8" strokeDasharray="4 4" />}
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-100">Forecast values</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-900/80">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {result.forecast.map((p: ForecastPoint) => (
                    <tr key={p.date} className="hover:bg-slate-800/30">
                      <td className="px-4 py-3 text-slate-300">{new Date(p.date).toLocaleDateString()}</td>
                      <td className="px-4 py-3 font-medium text-slate-100">{Number(p.value).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
