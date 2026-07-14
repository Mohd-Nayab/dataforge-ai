import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { useState } from "react";

import ExportMenu from "@/components/ui/ExportMenu";
import { NoDataset, PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import { useDataset } from "@/store/dataset";

export default function Preview() {
  const { active } = useDataset();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["preview", active?.id, page, search, sortBy, sortDir],
    queryFn: () =>
      dataApi.preview(active!.id, {
        page,
        page_size: 50,
        search: search || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
      }),
    enabled: !!active,
  });

  if (!active) return <NoDataset />;

  function toggleSort(col: string) {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPage(1);
  }

  return (
    <div>
      <PageHeader title="Data Preview" subtitle={active.name}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput);
            setPage(1);
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            className="input w-64 pl-9"
            placeholder="Search rows…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>
        <ExportMenu datasetId={active.id} />
      </PageHeader>

      <div className="glass overflow-hidden">
        {isLoading ? (
          <Spinner label="Loading rows…" />
        ) : isError ? (
          <div className="py-12 text-center text-sm text-rose-400">Failed to load data. Try refreshing.</div>
        ) : !data ? (
          <div className="py-12 text-center text-sm text-slate-400">No data</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-slate-900/90 backdrop-blur">
                  <tr>
                    <th className="border-b border-white/10 px-3 py-2.5 text-left text-xs font-semibold text-slate-500">
                      #
                    </th>
                    {data.columns.map((col) => (
                      <th
                        key={col.name}
                        className="cursor-pointer whitespace-nowrap border-b border-white/10 px-4 py-2.5 text-left font-semibold text-slate-200 hover:bg-white/5"
                        onClick={() => toggleSort(col.name)}
                      >
                        <div className="flex items-center gap-1.5">
                          {col.name}
                          {sortBy === col.name &&
                            (sortDir === "asc" ? (
                              <ArrowUp className="h-3 w-3 text-brand-400" />
                            ) : (
                              <ArrowDown className="h-3 w-3 text-brand-400" />
                            ))}
                          <span className="text-[10px] font-normal text-slate-500">
                            {col.dtype}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-white/5">
                      <td className="border-b border-white/5 px-3 py-2 text-xs text-slate-600">
                        {(page - 1) * data.page_size + i + 1}
                      </td>
                      {data.columns.map((col) => (
                        <td
                          key={col.name}
                          className="max-w-xs truncate whitespace-nowrap border-b border-white/5 px-4 py-2 text-slate-300"
                        >
                          {formatCell(row[col.name])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-sm">
              <span className="text-slate-400">
                {data.total.toLocaleString()} rows · page {data.page} of{" "}
                {data.total_pages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="btn-ghost px-2.5 py-1.5"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  className="btn-ghost px-2.5 py-1.5"
                  disabled={page >= data.total_pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}
