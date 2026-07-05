import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import { PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { DatasetMeta } from "@/lib/types";
import { useDataset } from "@/store/dataset";

export default function Datasets() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { active, setActive } = useDataset();

  const { data, isLoading } = useQuery({
    queryKey: ["datasets"],
    queryFn: dataApi.list,
  });

  const del = useMutation({
    mutationFn: (id: string) => dataApi.remove(id),
    onSuccess: (_d, id) => {
      toast.success("Dataset deleted");
      if (active?.id === id) setActive(null);
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
    },
  });

  function open(d: DatasetMeta) {
    setActive(d);
    navigate("/preview");
  }

  if (isLoading) return <Spinner label="Loading datasets…" />;

  return (
    <div>
      <PageHeader title="Datasets" subtitle="All your uploaded data." />
      {(data ?? []).length === 0 ? (
        <div className="card py-12 text-center text-sm text-slate-400">
          No datasets yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).map((d) => (
            <div
              key={d.id}
              className={`card glass-hover cursor-pointer ${
                active?.id === d.id ? "ring-1 ring-brand-500/50" : ""
              }`}
              onClick={() => open(d)}
            >
              <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600/20 text-brand-300">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <button
                  className="rounded-lg p-2 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${d.name}"?`)) del.mutate(d.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-3 truncate font-semibold text-slate-100">{d.name}</p>
              <p className="truncate text-xs text-slate-500">{d.filename}</p>
              <div className="mt-3 flex gap-4 text-xs text-slate-400">
                <span>{d.rows.toLocaleString()} rows</span>
                <span>{d.columns} cols</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
