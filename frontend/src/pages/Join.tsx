import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitMerge } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { NoDataset, PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { JoinResponse } from "@/lib/types";
import { useDataset } from "@/store/dataset";

export default function Join() {
  const { active, setActive } = useDataset();
  const queryClient = useQueryClient();
  const [rightId, setRightId] = useState("");
  const [leftOn, setLeftOn] = useState("");
  const [rightOn, setRightOn] = useState("");
  const [how, setHow] = useState<"inner" | "left" | "right" | "outer">("inner");
  const [name, setName] = useState("");
  const [result, setResult] = useState<JoinResponse | null>(null);

  const { data: datasets, isLoading: dsLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: dataApi.list,
  });

  const { data: leftCols } = useQuery({
    queryKey: ["preview", active?.id, "join-left-cols"],
    queryFn: () => dataApi.preview(active!.id, { page: 1, page_size: 1 }).then((r) => r.columns),
    enabled: !!active,
  });

  const { data: rightCols } = useQuery({
    queryKey: ["preview", rightId, "join-right-cols"],
    queryFn: () => dataApi.preview(rightId, { page: 1, page_size: 1 }).then((r) => r.columns),
    enabled: !!rightId,
  });

  useEffect(() => {
    if (leftCols?.length && !leftOn) setLeftOn(leftCols[0].name);
  }, [leftCols, leftOn]);

  useEffect(() => {
    if (rightCols?.length && !rightOn) setRightOn(rightCols[0].name);
  }, [rightCols, rightOn]);

  const joinMut = useMutation({
    mutationFn: () =>
      dataApi.join(active!.id, {
        right_id: rightId,
        left_on: leftOn,
        right_on: rightOn,
        how,
        name: name.trim() || undefined,
      }),
    onSuccess: (res) => {
      setResult(res);
      setActive(res.meta);
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(res.message);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Join failed"),
  });

  if (!active) return <NoDataset message="Select a left dataset, then join another dataset." />;
  if (dsLoading) return <Spinner label="Loading datasets…" />;

  const others = (datasets ?? []).filter((d) => d.id !== active.id);

  return (
    <div>
      <PageHeader title="Dataset Join" subtitle={`Left: ${active.name}`} />

      <div className="card mb-6 max-w-3xl">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <GitMerge className="h-4 w-4 text-brand-400" />
          Merge two datasets
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Right dataset</label>
            <select
              className="input w-full"
              value={rightId}
              onChange={(e) => {
                setRightId(e.target.value);
                setRightOn("");
              }}
            >
              <option value="">Select dataset…</option>
              {others.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.rows} × {d.columns})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Join type</label>
            <select
              className="input w-full"
              value={how}
              onChange={(e) => setHow(e.target.value as typeof how)}
            >
              <option value="inner">Inner</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="outer">Outer</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Left key</label>
            <select className="input w-full" value={leftOn} onChange={(e) => setLeftOn(e.target.value)}>
              {(leftCols ?? []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Right key</label>
            <select
              className="input w-full"
              value={rightOn}
              onChange={(e) => setRightOn(e.target.value)}
              disabled={!rightId}
            >
              {(rightCols ?? []).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-slate-400">Result name (optional)</label>
            <input
              className="input w-full"
              placeholder={`${active.name}_join_…`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>

        <button
          className="btn-primary mt-4"
          disabled={!rightId || !leftOn || !rightOn || joinMut.isPending}
          onClick={() => joinMut.mutate()}
        >
          {joinMut.isPending ? <Spinner label="" /> : <GitMerge className="h-4 w-4" />}
          Run join
        </button>

        {others.length === 0 && (
          <p className="mt-3 text-xs text-amber-400">
            Upload a second dataset first — join needs two datasets.
          </p>
        )}
      </div>

      {result && (
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Join result</h3>
          <p className="text-sm text-slate-300">{result.message}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
            <Stat label="Left rows" value={result.left_rows} />
            <Stat label="Right rows" value={result.right_rows} />
            <Stat label="Result rows" value={result.result_rows} />
            <Stat label="How" value={result.how} />
          </div>
          {result.sample.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-900/80">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {Object.keys(result.sample[0]).map((c) => (
                      <th key={c} className="px-3 py-2">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.sample.map((row, i) => (
                    <tr key={i} className="border-t border-white/5">
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-3 py-2 text-slate-300">
                          {v === null || v === undefined ? "—" : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-slate-500">{label}</div>
      <div className="text-base font-semibold text-slate-200">{value}</div>
    </div>
  );
}
