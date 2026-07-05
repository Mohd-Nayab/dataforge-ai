import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Sparkles,
  Undo2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import ExportMenu from "@/components/ui/ExportMenu";
import { NoDataset, PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { ValidationIssue } from "@/lib/types";
import { useDataset } from "@/store/dataset";

interface OpButton {
  label: string;
  operation: string;
  params?: Record<string, unknown>;
  group: string;
  requiresColumns?: boolean;
}

const OPS: OpButton[] = [
  { group: "Rows", label: "Remove Duplicates", operation: "remove_duplicates" },
  { group: "Rows", label: "Drop Null Rows", operation: "drop_nulls", params: { how: "any" } },
  { group: "Missing", label: "Fill — Mean", operation: "fill_missing", params: { method: "mean" } },
  { group: "Missing", label: "Fill — Median", operation: "fill_missing", params: { method: "median" } },
  { group: "Missing", label: "Fill — Mode", operation: "fill_missing", params: { method: "mode" } },
  { group: "Missing", label: "Forward Fill", operation: "fill_missing", params: { method: "ffill" } },
  { group: "Missing", label: "Backward Fill", operation: "fill_missing", params: { method: "bfill" } },
  { group: "Text", label: "Trim Spaces", operation: "trim_spaces" },
  { group: "Text", label: "lowercase", operation: "change_case", params: { case: "lower" } },
  { group: "Text", label: "UPPERCASE", operation: "change_case", params: { case: "upper" } },
  { group: "Text", label: "Title Case", operation: "change_case", params: { case: "title" } },
  { group: "Text", label: "Remove Special Chars", operation: "remove_special_chars" },
  { group: "Outliers", label: "Remove (IQR)", operation: "remove_outliers", params: { method: "iqr" } },
  { group: "Outliers", label: "Remove (Z-Score)", operation: "remove_outliers", params: { method: "zscore" } },
  { group: "Scaling", label: "Min-Max Normalize", operation: "normalize", params: { method: "minmax" } },
  { group: "Scaling", label: "Standardize", operation: "normalize", params: { method: "standard" } },
  { group: "Encoding", label: "Label Encode", operation: "label_encode" },
  { group: "Encoding", label: "One-Hot Encode", operation: "one_hot_encode" },
  { group: "Columns", label: "Drop Selected", operation: "drop_columns", requiresColumns: true },
  { group: "Columns", label: "To Text", operation: "change_dtype", params: { dtype: "string" }, requiresColumns: true },
  { group: "Columns", label: "To Integer", operation: "change_dtype", params: { dtype: "int" }, requiresColumns: true },
  { group: "Columns", label: "To Float", operation: "change_dtype", params: { dtype: "float" }, requiresColumns: true },
  { group: "Columns", label: "To Date", operation: "change_dtype", params: { dtype: "datetime" }, requiresColumns: true },
];

const GROUPS = ["Rows", "Missing", "Text", "Outliers", "Scaling", "Encoding", "Columns"];

const SEVERITY_ICON = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
};
const SEVERITY_COLOR = {
  error: "text-rose-400",
  warning: "text-amber-400",
  info: "text-sky-400",
  success: "text-emerald-400",
};

export default function CleaningStudio() {
  const { active, setActive } = useDataset();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [renameTo, setRenameTo] = useState("");
  const [splitDelim, setSplitDelim] = useState(",");
  const [mergeSep, setMergeSep] = useState(" ");
  const [mergeName, setMergeName] = useState("merged");

  const { data: issues, isLoading: validating } = useQuery({
    queryKey: ["validate", active?.id],
    queryFn: () => dataApi.validate(active!.id),
    enabled: !!active,
  });

  const { data: columns } = useQuery({
    queryKey: ["columns", active?.id, active?.updated_at],
    queryFn: async () =>
      (await dataApi.preview(active!.id, { page: 1, page_size: 1 })).columns,
    enabled: !!active,
  });

  function toggleColumn(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
  }

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ["validate", active?.id] });
    queryClient.invalidateQueries({ queryKey: ["preview"] });
    queryClient.invalidateQueries({ queryKey: ["overview"] });
    queryClient.invalidateQueries({ queryKey: ["datasets"] });
  }

  const clean = useMutation({
    mutationFn: (op: OpButton) => {
      const params: Record<string, unknown> = { ...(op.params ?? {}) };
      if (selected.length) params.columns = selected;
      return dataApi.clean(active!.id, op.operation, params);
    },
    onSuccess: (res) => {
      toast.success(res.message);
      setActive(res.meta);
      refreshAll();
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Operation failed"),
  });

  const auto = useMutation({
    mutationFn: () => dataApi.autoClean(active!.id),
    onSuccess: (res) => {
      toast.success("Auto-clean complete");
      setActive(res.meta);
      refreshAll();
    },
  });

  const undo = useMutation({
    mutationFn: () => dataApi.undo(active!.id),
    onSuccess: (meta) => {
      toast.success("Reverted last change");
      setActive(meta);
      refreshAll();
    },
  });

  if (!active) return <NoDataset />;

  return (
    <div>
      <PageHeader title="Cleaning Studio" subtitle={active.name}>
        <button className="btn-ghost" onClick={() => undo.mutate()} disabled={undo.isPending}>
          <Undo2 className="h-4 w-4" /> Undo
        </button>
        <ExportMenu datasetId={active.id} />
        <button className="btn-primary" onClick={() => auto.mutate()} disabled={auto.isPending}>
          <Sparkles className="h-4 w-4" /> Auto Clean
        </button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card mb-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Apply to columns
              </h3>
              {selected.length > 0 && (
                <button
                  className="text-xs font-medium text-brand-400 hover:text-brand-300"
                  onClick={() => setSelected([])}
                >
                  Clear ({selected.length})
                </button>
              )}
            </div>
            <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {(columns ?? []).map((c) => {
                const on = selected.includes(c.name);
                return (
                  <button
                    key={c.name}
                    onClick={() => toggleColumn(c.name)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      on
                        ? "bg-brand-600/30 text-white ring-1 ring-brand-500/50"
                        : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {selected.length
                ? `Operations target ${selected.length} selected column(s).`
                : "No selection — operations apply to all applicable columns."}
            </p>
          </div>

          {GROUPS.map((group) => (
            <div key={group} className="mb-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {group}
              </h3>
              <div className="flex flex-wrap gap-2">
                {OPS.filter((o) => o.group === group).map((op) => {
                  const blocked = !!op.requiresColumns && selected.length === 0;
                  return (
                    <button
                      key={op.label}
                      className="btn-ghost disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={clean.isPending || blocked}
                      title={blocked ? "Select one or more columns first" : undefined}
                      onClick={() => clean.mutate(op)}
                    >
                      {op.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="card mt-1">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Column Transforms
            </h3>
            <p className="mb-3 text-xs text-slate-500">
              Use the column selector above to choose targets, then apply.
            </p>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Rename <span className="text-slate-500">(select exactly 1 column)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    placeholder="New column name"
                    value={renameTo}
                    onChange={(e) => setRenameTo(e.target.value)}
                  />
                  <button
                    className="btn-ghost shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={clean.isPending || selected.length !== 1 || !renameTo.trim()}
                    onClick={() => {
                      clean.mutate({
                        group: "",
                        label: "Rename",
                        operation: "rename_column",
                        params: { old: selected[0], new: renameTo.trim() },
                      });
                      setRenameTo("");
                      setSelected([]);
                    }}
                  >
                    Rename
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Split <span className="text-slate-500">(select exactly 1 column)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    className="input w-24 shrink-0"
                    placeholder="Delim"
                    value={splitDelim}
                    onChange={(e) => setSplitDelim(e.target.value)}
                  />
                  <button
                    className="btn-ghost flex-1 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={clean.isPending || selected.length !== 1 || !splitDelim}
                    onClick={() =>
                      clean.mutate({
                        group: "",
                        label: "Split",
                        operation: "split_column",
                        params: { column: selected[0], delimiter: splitDelim },
                      })
                    }
                  >
                    Split on delimiter
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Merge <span className="text-slate-500">(select 2+ columns)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    className="input w-20 shrink-0"
                    placeholder="Sep"
                    value={mergeSep}
                    onChange={(e) => setMergeSep(e.target.value)}
                  />
                  <input
                    className="input flex-1"
                    placeholder="New column name"
                    value={mergeName}
                    onChange={(e) => setMergeName(e.target.value)}
                  />
                  <button
                    className="btn-ghost shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={clean.isPending || selected.length < 2 || !mergeName.trim()}
                    onClick={() => {
                      clean.mutate({
                        group: "",
                        label: "Merge",
                        operation: "merge_columns",
                        params: {
                          columns: selected,
                          separator: mergeSep,
                          new: mergeName.trim(),
                        },
                      });
                      setSelected([]);
                    }}
                  >
                    Merge
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="mb-3 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> Validation Report
          </h3>
          {validating ? (
            <Spinner />
          ) : (
            <div className="space-y-2">
              {(issues ?? []).map((issue: ValidationIssue, i) => {
                const Icon = SEVERITY_ICON[issue.severity];
                return (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-white/5 p-2.5">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${SEVERITY_COLOR[issue.severity]}`} />
                    <p className="text-xs text-slate-300">{issue.message}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
