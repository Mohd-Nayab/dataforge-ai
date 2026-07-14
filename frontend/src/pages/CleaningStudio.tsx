import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  FileText,
  Info,
  ShieldCheck,
  TrendingUp,
  Undo2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import ExportMenu from "@/components/ui/ExportMenu";
import { NoDataset, PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { AuditEntry, EnterpriseValidationReport, FuzzyDuplicateResult, OutlierReportResponse, SmartCleanResult, ValidationIssue } from "@/lib/types";
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
  { group: "Rows", label: "Sample 100 Rows", operation: "sample_rows", params: { n: 100 } },
  { group: "Rows", label: "Sample 10%", operation: "sample_rows", params: { frac: 0.1 } },
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
  const [filterCol, setFilterCol] = useState("");
  const [filterOp, setFilterOp] = useState("==");
  const [filterValue, setFilterValue] = useState("");
  const [formulaExpr, setFormulaExpr] = useState("");
  const [formulaName, setFormulaName] = useState("formula_result");

  const { data: valReport, isLoading: validating } = useQuery({
    queryKey: ["enterprise-validate", active?.id],
    queryFn: () => dataApi.enterpriseValidate(active!.id),
    enabled: !!active,
  });
  const issues = valReport?.issues;

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
    queryClient.invalidateQueries({ queryKey: ["enterprise-validate", active?.id] });
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
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Auto-clean failed"),
  });

  const [smartResult, setSmartResult] = useState<SmartCleanResult | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [rightTab, setRightTab] = useState<"validation" | "fuzzy" | "outliers">("validation");

  const { data: fuzzyResult } = useQuery({
    queryKey: ["fuzzy-duplicates", active?.id],
    queryFn: () => dataApi.fuzzyDuplicates(active!.id, 0.85),
    enabled: !!active && rightTab === "fuzzy",
  });

  const { data: outlierResult } = useQuery({
    queryKey: ["outlier-report", active?.id],
    queryFn: () => dataApi.outlierReport(active!.id),
    enabled: !!active && rightTab === "outliers",
  });

  const smartDryRun = useMutation({
    mutationFn: () => dataApi.smartClean(active!.id, true),
    onSuccess: (res) => {
      setSmartResult(res);
      if (res.halted) {
        toast.error(`Halted: ${res.halt_reason}`);
      } else {
        toast.success(`Dry run: ${res.cells_changed} cells would change`);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Smart clean failed"),
  });

  const smartApply = useMutation({
    mutationFn: () => dataApi.smartClean(active!.id, false),
    onSuccess: (res) => {
      setSmartResult(res);
      if (res.halted) {
        toast.error(`Halted: ${res.halt_reason}`);
      } else {
        toast.success(`Smart clean complete: ${res.cells_changed} cells changed`);
        if (res.meta) setActive(res.meta);
        refreshAll();
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Smart clean failed"),
  });

  const { data: auditLog } = useQuery({
    queryKey: ["audit-log", active?.id, showAudit],
    queryFn: () => dataApi.getAuditLog(active!.id),
    enabled: !!active && showAudit,
  });

  const undo = useMutation({
    mutationFn: () => dataApi.undo(active!.id),
    onSuccess: (meta) => {
      toast.success("Reverted last change");
      setActive(meta);
      refreshAll();
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Undo failed"),
  });

  if (!active) return <NoDataset />;

  return (
    <div>
      <PageHeader title="Cleaning Studio" subtitle={active.name}>
        <button className="btn-ghost" onClick={() => undo.mutate()} disabled={undo.isPending}>
          <Undo2 className="h-4 w-4" /> Undo
        </button>
        <button
          className="btn-ghost"
          onClick={() => setShowAudit((v) => !v)}
        >
          <FileText className="h-4 w-4" /> Audit Log
        </button>
        <ExportMenu datasetId={active.id} />
        <button
          className="btn-ghost"
          onClick={() => smartDryRun.mutate()}
          disabled={smartDryRun.isPending || smartApply.isPending}
        >
          <Eye className="h-4 w-4" /> Preview Smart Clean
        </button>
        <button
          className="btn-primary"
          onClick={() => smartApply.mutate()}
          disabled={smartDryRun.isPending || smartApply.isPending}
        >
          <ShieldCheck className="h-4 w-4" /> Smart Clean
        </button>
      </PageHeader>

      {smartResult && (
        <div className={`card mb-5 ${smartResult.halted ? "border-amber-500/30" : "border-emerald-500/20"}`}>
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              {smartResult.halted ? (
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              )}
              Smart Clean {smartResult.halted ? "Halted" : "Results"}
            </h3>
            <button className="text-xs text-slate-500 hover:text-slate-300" onClick={() => setSmartResult(null)}>
              Dismiss
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-slate-500">Rows: </span>
              <span className="font-medium text-slate-200">{smartResult.rows_before} → {smartResult.rows_after}</span>
            </div>
            <div>
              <span className="text-slate-500">Cells changed: </span>
              <span className="font-medium text-slate-200">{smartResult.cells_changed}</span>
            </div>
            <div>
              <span className="text-slate-500">Audit entries: </span>
              <span className="font-medium text-slate-200">{smartResult.audit_log.length}</span>
            </div>
          </div>
          {smartResult.halted && (
            <p className="mt-2 text-xs text-amber-400">{smartResult.halt_reason}</p>
          )}
          <p className="mt-2 text-xs text-slate-400">{smartResult.summary}</p>
          {smartResult.audit_log.length > 0 && (
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-slate-900/50 p-3">
              <AuditLogTable entries={smartResult.audit_log.slice(0, 50)} />
            </div>
          )}
        </div>
      )}

      {showAudit && auditLog && auditLog.length > 0 && (
        <div className="card mb-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-brand-400" /> Audit Trail ({auditLog.length} entries)
          </h3>
          <div className="max-h-64 overflow-y-auto rounded-lg bg-slate-900/50 p-3">
            <AuditLogTable entries={auditLog.slice(0, 100)} />
          </div>
        </div>
      )}
      {showAudit && (!auditLog || auditLog.length === 0) && (
        <div className="card mb-5 text-sm text-slate-500">
          No audit entries yet. Run Smart Clean to generate an audit trail.
        </div>
      )}

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

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Filter rows
                </label>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="input min-w-[8rem] flex-1"
                    value={filterCol}
                    onChange={(e) => setFilterCol(e.target.value)}
                  >
                    <option value="">Column…</option>
                    {(columns ?? []).map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input w-32 shrink-0"
                    value={filterOp}
                    onChange={(e) => setFilterOp(e.target.value)}
                  >
                    {["==", "!=", ">", ">=", "<", "<=", "contains", "not_contains", "is_null", "not_null"].map(
                      (op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      )
                    )}
                  </select>
                  <input
                    className="input min-w-[6rem] flex-1"
                    placeholder="Value"
                    value={filterValue}
                    onChange={(e) => setFilterValue(e.target.value)}
                    disabled={filterOp === "is_null" || filterOp === "not_null"}
                  />
                  <button
                    className="btn-ghost shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={
                      clean.isPending ||
                      !filterCol ||
                      (filterOp !== "is_null" && filterOp !== "not_null" && filterValue === "")
                    }
                    onClick={() =>
                      clean.mutate({
                        group: "",
                        label: "Filter",
                        operation: "filter_rows",
                        params: {
                          column: filterCol,
                          op: filterOp,
                          value: filterValue,
                        },
                      })
                    }
                  >
                    Apply filter
                  </button>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Formula column{" "}
                  <span className="text-slate-500">(e.g. salary * 1.1 or age + 1)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="input min-w-[10rem] flex-1"
                    placeholder="Expression"
                    value={formulaExpr}
                    onChange={(e) => setFormulaExpr(e.target.value)}
                  />
                  <input
                    className="input w-36 shrink-0"
                    placeholder="New name"
                    value={formulaName}
                    onChange={(e) => setFormulaName(e.target.value)}
                  />
                  <button
                    className="btn-ghost shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={clean.isPending || !formulaExpr.trim() || !formulaName.trim()}
                    onClick={() =>
                      clean.mutate({
                        group: "",
                        label: "Formula",
                        operation: "formula_column",
                        params: {
                          expression: formulaExpr.trim(),
                          new: formulaName.trim(),
                        },
                      })
                    }
                  >
                    Create column
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card flex flex-col">
          {/* Tab bar */}
          <div className="mb-3 flex gap-1 border-b border-white/10 pb-2">
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${rightTab === "validation" ? "bg-brand-600/20 text-brand-300" : "text-slate-400 hover:text-slate-200"}`}
              onClick={() => setRightTab("validation")}
            >
              <AlertTriangle className="h-3.5 w-3.5" /> Validation
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${rightTab === "fuzzy" ? "bg-brand-600/20 text-brand-300" : "text-slate-400 hover:text-slate-200"}`}
              onClick={() => setRightTab("fuzzy")}
            >
              <Copy className="h-3.5 w-3.5" /> Fuzzy Dups
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${rightTab === "outliers" ? "bg-brand-600/20 text-brand-300" : "text-slate-400 hover:text-slate-200"}`}
              onClick={() => setRightTab("outliers")}
            >
              <TrendingUp className="h-3.5 w-3.5" /> Outliers
            </button>
          </div>

          {/* Validation tab */}
          {rightTab === "validation" && (
            <>
              {valReport && (
                <div className="mb-3 flex items-center justify-between rounded-lg bg-white/5 p-3">
                  <div>
                    <p className="text-xs text-slate-500">Overall Quality</p>
                    <p className={`text-2xl font-bold ${valReport.overall_quality >= 80 ? "text-emerald-400" : valReport.overall_quality >= 60 ? "text-amber-400" : "text-rose-400"}`}>
                      {valReport.overall_quality}/100
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Total Issues</p>
                    <p className="text-2xl font-bold text-slate-200">{valReport.total_issues}</p>
                  </div>
                </div>
              )}
              {validating ? (
                <Spinner />
              ) : (
                <div className="space-y-2">
                  {(issues ?? []).map((issue: ValidationIssue, i) => {
                    const Icon = SEVERITY_ICON[issue.severity] ?? Info;
                    const color = SEVERITY_COLOR[issue.severity] ?? "text-slate-400";
                    return (
                      <div key={i} className="flex items-start gap-2 rounded-lg bg-white/5 p-2.5">
                        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${color}`} />
                        <p className="text-xs text-slate-300">{issue.message}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Fuzzy duplicates tab */}
          {rightTab === "fuzzy" && (
            <>
              {fuzzyResult && (
                <div className="mb-3 flex items-center justify-between rounded-lg bg-white/5 p-3">
                  <div>
                    <p className="text-xs text-slate-500">Potential Duplicates</p>
                    <p className="text-2xl font-bold text-amber-400">{fuzzyResult.total_potential_duplicates}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Groups</p>
                    <p className="text-2xl font-bold text-slate-200">{fuzzyResult.groups.length}</p>
                  </div>
                </div>
              )}
              {fuzzyResult ? (
                fuzzyResult.groups.length > 0 ? (
                  <div className="space-y-2">
                    {fuzzyResult.groups.map((group, i) => (
                      <div key={i} className="rounded-lg bg-white/5 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-300">Group {i + 1}</span>
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${group.similarity_score >= 0.95 ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-300"}`}>
                            {Math.round(group.similarity_score * 100)}% similar
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs text-slate-400">
                          Rows: <span className="font-mono text-slate-300">{group.row_indices.join(", ")}</span>
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Action: <span className="text-slate-400">{group.suggested_action}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" /> No fuzzy duplicates detected.
                  </div>
                )
              ) : (
                <Spinner />
              )}
            </>
          )}

          {/* Outliers tab */}
          {rightTab === "outliers" && (
            <>
              {outlierResult && (
                <div className="mb-3 flex items-center justify-between rounded-lg bg-white/5 p-3">
                  <div>
                    <p className="text-xs text-slate-500">Total Flags</p>
                    <p className="text-2xl font-bold text-amber-400">{outlierResult.total_outliers}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Columns</p>
                    <p className="text-2xl font-bold text-slate-200">{Object.keys(outlierResult.column_reports).length}</p>
                  </div>
                </div>
              )}
              {outlierResult ? (
                <div className="space-y-2">
                  {Object.entries(outlierResult.column_reports).map(([col, rpt]) => (
                    <div key={col} className="rounded-lg bg-white/5 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-300">{col}</span>
                        <span className={`rounded px-2 py-0.5 text-xs ${rpt.total_unique_outliers > 0 ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                          {rpt.total_unique_outliers} outlier{rpt.total_unique_outliers !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <div className="text-center">
                          <p className="text-slate-500">IQR</p>
                          <p className={`font-medium ${rpt.iqr.count > 0 ? "text-amber-400" : "text-slate-400"}`}>{rpt.iqr.count}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-slate-500">Z-Score</p>
                          <p className={`font-medium ${rpt.zscore.count > 0 ? "text-amber-400" : "text-slate-400"}`}>{rpt.zscore.count}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-slate-500">Mod Z</p>
                          <p className={`font-medium ${rpt.modified_zscore.count > 0 ? "text-amber-400" : "text-slate-400"}`}>{rpt.modified_zscore.count}</p>
                        </div>
                      </div>
                      {rpt.iqr.bounds && (
                        <p className="mt-1.5 text-xs text-slate-500">
                          IQR bounds: [{rpt.iqr.bounds[0]}, {rpt.iqr.bounds[1]}]
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <Spinner />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditLogTable({ entries }: { entries: AuditEntry[] }) {
  return (
    <table className="w-full border-collapse text-xs">
      <thead className="bg-slate-900/80">
        <tr className="text-left text-slate-500">
          <th className="px-2 py-1.5">Column</th>
          <th className="px-2 py-1.5">Row</th>
          <th className="px-2 py-1.5">Old</th>
          <th className="px-2 py-1.5">New</th>
          <th className="px-2 py-1.5">Method</th>
          <th className="px-2 py-1.5">Conf.</th>
          <th className="px-2 py-1.5">Reason</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => (
          <tr key={i} className="border-t border-white/5">
            <td className="px-2 py-1 font-medium text-slate-300">{e.column}</td>
            <td className="px-2 py-1 text-slate-400">{e.row_index}</td>
            <td className="px-2 py-1 text-rose-300/80">{truncate(String(e.old_value))}</td>
            <td className="px-2 py-1 text-emerald-300/80">{truncate(String(e.new_value))}</td>
            <td className="px-2 py-1 text-slate-400">{e.method}</td>
            <td className="px-2 py-1">
              <span className={`rounded px-1.5 py-0.5 ${e.confidence >= 0.9 ? "bg-emerald-500/20 text-emerald-300" : e.confidence >= 0.7 ? "bg-amber-500/20 text-amber-300" : "bg-rose-500/20 text-rose-300"}`}>
                {Math.round(e.confidence * 100)}%
              </span>
            </td>
            <td className="px-2 py-1 text-slate-500">{truncate(e.reason, 60)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function truncate(s: string, max = 30): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
