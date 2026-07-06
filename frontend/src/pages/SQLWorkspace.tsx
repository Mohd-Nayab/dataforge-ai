import { useMutation } from "@tanstack/react-query";
import { Play, Terminal, Zap } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { PageHeader, NoDataset, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { SqlResponse } from "@/lib/types";
import { useDataset } from "@/store/dataset";

const DEFAULT_QUERY = "SELECT city, COUNT(*) AS count, AVG(salary) AS avg_salary\nFROM data\nGROUP BY city\nORDER BY count DESC;";

export default function SQLWorkspace() {
  const { active } = useDataset();
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [result, setResult] = useState<SqlResponse | null>(null);

  const run = useMutation({
    mutationFn: () => dataApi.sql(active!.id, query, 1000),
    onSuccess: (res) => {
      setResult(res);
      toast.success(`${res.row_count.toLocaleString()} row(s) returned`);
    },
    onError: (e: any) => {
      const detail = e?.response?.data?.detail ?? "Query failed";
      toast.error(detail);
      setResult(null);
    },
  });

  if (!active) return <NoDataset message="Pick a dataset to query it with SQL." />;

  return (
    <div>
      <PageHeader title="SQL Workspace" subtitle={active.name}>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={() => setQuery(DEFAULT_QUERY)}>
            Reset
          </button>
          <button
            className="btn-primary"
            disabled={!query.trim() || run.isPending}
            onClick={() => run.mutate()}
          >
            {run.isPending ? <Spinner label="" /> : <Play className="h-4 w-4" />}
            Run query
          </button>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card mb-4">
            <div className="mb-2 flex items-center gap-2">
              <Terminal className="h-4 w-4 text-brand-400" />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Query editor
              </span>
            </div>
            <textarea
              className="input h-56 w-full font-mono text-sm leading-relaxed"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SELECT * FROM data WHERE ..."
              spellCheck={false}
            />
            <p className="mt-2 text-xs text-slate-500">
              Table is exposed as <code className="text-brand-300">data</code> (alias{" "}
              <code className="text-brand-300">dataset</code>
              {active.name && (
                <>
                  {" "}or <code className="text-brand-300">{active.name.replace(/[^0-9a-zA-Z_]/g, "_").toLowerCase()}</code>
                </>
              )}
              ). Only read-only SELECT / WITH statements are allowed.
            </p>
          </div>
        </div>

        <div className="card">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Example queries
          </h3>
          <ul className="space-y-2 text-xs text-slate-400">
            <li>
              <button
                className="w-full rounded-lg bg-white/5 p-2 text-left font-mono text-brand-300 hover:bg-white/10"
                onClick={() => setQuery("SELECT * FROM data LIMIT 10;")}
              >
                SELECT * FROM data LIMIT 10;
              </button>
            </li>
            <li>
              <button
                className="w-full rounded-lg bg-white/5 p-2 text-left font-mono text-brand-300 hover:bg-white/10"
                onClick={() =>
                  setQuery("SELECT city, COUNT(*) AS count FROM data GROUP BY city;")
                }
              >
                SELECT city, COUNT(*) FROM data GROUP BY city;
              </button>
            </li>
            <li>
              <button
                className="w-full rounded-lg bg-white/5 p-2 text-left font-mono text-brand-300 hover:bg-white/10"
                onClick={() =>
                  setQuery("SELECT name, email FROM data WHERE age > 30;")
                }
              >
                SELECT name, email FROM data WHERE age &gt; 30;
              </button>
            </li>
          </ul>
        </div>
      </div>

      {run.isPending && (
        <div className="card mt-4 flex items-center justify-center py-12">
          <Spinner label="Running query…" />
        </div>
      )}

      {result && !run.isPending && (
        <div className="card mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">Results</h3>
            <span className="flex items-center gap-2 text-xs text-slate-400">
              {result.cached && (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-600/20 px-2 py-0.5 text-[11px] font-medium text-brand-300">
                  <Zap className="h-3 w-3" /> cached
                </span>
              )}
              {result.row_count.toLocaleString()} row(s)
              {result.truncated && ` (truncated to ${result.limit})`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-900/80">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {result.columns.map((c) => (
                    <th key={c.name} className="px-3 py-2">
                      {c.name}
                      <span className="ml-1 font-normal text-slate-600">({c.dtype})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                    {result.columns.map((c) => (
                      <td key={c.name} className="px-3 py-2 text-slate-300">
                        {formatValue(row[c.name])}
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

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(4);
  return String(v);
}
