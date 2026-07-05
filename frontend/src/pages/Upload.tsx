import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileUp, Loader2, UploadCloud, XCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import { PageHeader } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import { useDataset } from "@/store/dataset";

interface UploadItem {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

const ACCEPTED = {
  "text/csv": [".csv"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/json": [".json"],
  "text/plain": [".txt"],
  "application/octet-stream": [".parquet", ".feather"],
};

export default function Upload() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [engine, setEngine] = useState<"pandas" | "polars" | "dask">("pandas");
  const { setActive } = useDataset();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const onDrop = useCallback((accepted: File[]) => {
    setItems((prev) => [
      ...prev,
      ...accepted.map((file) => ({ file, status: "pending" as const, progress: 0 })),
    ]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    multiple: true,
  });

  async function uploadAll() {
    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "done") continue;
      setItems((prev) =>
        prev.map((it, idx) => (idx === i ? { ...it, status: "uploading" } : it))
      );
      try {
        const meta = await dataApi.upload(items[i].file, engine, (pct) =>
          setItems((prev) =>
            prev.map((it, idx) => (idx === i ? { ...it, progress: pct } : it))
          )
        );
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i ? { ...it, status: "done", progress: 100 } : it
          )
        );
        setActive(meta);
      } catch (e: any) {
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i
              ? {
                  ...it,
                  status: "error",
                  error: e?.response?.data?.detail ?? "Upload failed",
                }
              : it
          )
        );
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["datasets"] });
    const anyDone = items.some((it) => it.status !== "error");
    if (anyDone) {
      toast.success("Upload complete");
      navigate("/preview");
    }
  }

  return (
    <div>
      <PageHeader
        title="Upload Data"
        subtitle="Drag & drop CSV, Excel, JSON, TXT, Parquet or Feather files."
      />

      <div
        {...getRootProps()}
        className={`glass flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed py-16 transition ${
          isDragActive ? "border-brand-500 bg-brand-600/10" : "border-white/15"
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600/20 text-brand-300">
          <UploadCloud className="h-8 w-8" />
        </div>
        <p className="text-lg font-semibold text-slate-100">
          {isDragActive ? "Drop files here" : "Drag files here, or click to browse"}
        </p>
        <p className="text-sm text-slate-400">Supports multiple files</p>
      </div>

      {items.length > 0 && (
        <div className="card mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">Files ({items.length})</h3>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Engine</label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value as "pandas" | "polars" | "dask")}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
              >
                <option value="pandas">Pandas</option>
                <option value="polars">Polars</option>
                <option value="dask">Dask</option>
              </select>
              <button className="btn-ghost" onClick={() => setItems([])}>
                Clear
              </button>
              <button className="btn-primary" onClick={uploadAll}>
                <FileUp className="h-4 w-4" /> Upload all
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {it.file.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {(it.file.size / 1024).toFixed(1)} KB
                  </p>
                  {it.status === "uploading" && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full bg-brand-500 transition-all"
                        style={{ width: `${it.progress}%` }}
                      />
                    </div>
                  )}
                  {it.error && <p className="mt-1 text-xs text-rose-400">{it.error}</p>}
                </div>
                <div className="ml-4">
                  {it.status === "done" && (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  )}
                  {it.status === "error" && <XCircle className="h-5 w-5 text-rose-400" />}
                  {it.status === "uploading" && (
                    <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
