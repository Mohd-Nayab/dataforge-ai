import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { PageHeader, NoDataset, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { ColumnInfo, MLModel } from "@/lib/types";
import { useDataset } from "@/store/dataset";

const MODEL_OPTIONS: { value: string; label: string; task: "regression" | "classification" | "auto" }[] = [
  { value: "", label: "Auto", task: "auto" },
  { value: "random_forest_regressor", label: "Random Forest Regressor", task: "regression" },
  { value: "linear_regression", label: "Linear Regression", task: "regression" },
  { value: "random_forest_classifier", label: "Random Forest Classifier", task: "classification" },
  { value: "logistic_regression", label: "Logistic Regression", task: "classification" },
];

export default function MLStudio() {
  const { active } = useDataset();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [task, setTask] = useState<"auto" | "regression" | "classification">("auto");
  const [modelType, setModelType] = useState("");
  const [predictions, setPredictions] = useState<Record<string, unknown>[] | null>(null);
  const [predictModel, setPredictModel] = useState<MLModel | null>(null);

  const { data: columns } = useQuery({
    queryKey: ["preview", active?.id, "columns"],
    queryFn: () => dataApi.preview(active!.id, { page: 1, page_size: 1 }).then((r) => r.columns),
    enabled: !!active,
  });

  const { data: models, isLoading: modelsLoading } = useQuery({
    queryKey: ["ml-models", active?.id],
    queryFn: () => dataApi.listModels(active!.id),
    enabled: !!active,
  });

  const train = useMutation({
    mutationFn: () =>
      dataApi.trainModel(active!.id, {
        target,
        features: features.length ? features : undefined,
        task: task === "auto" ? undefined : task,
        model_type: modelType || undefined,
        test_size: 0.2,
      }),
    onSuccess: (res) => {
      toast.success(`Trained ${res.task} model ${res.model_id}`);
      queryClient.invalidateQueries({ queryKey: ["ml-models", active?.id] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Training failed"),
  });

  const predict = useMutation({
    mutationFn: (model: MLModel) => dataApi.predictModel(active!.id, model.model_id),
    onSuccess: (res, model) => {
      setPredictions(res.predictions);
      setPredictModel(model);
      toast.success(`Predicted ${res.rows} row(s)`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Prediction failed"),
  });

  const deleteModel = useMutation({
    mutationFn: (id: string) => dataApi.deleteModel(active!.id, id),
    onSuccess: (_, id) => {
      toast.success("Model deleted");
      queryClient.invalidateQueries({ queryKey: ["ml-models", active?.id] });
      if (predictModel && predictModel.model_id === id) {
        setPredictions(null);
        setPredictModel(null);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail ?? "Delete failed"),
  });

  const toggleFeature = (col: string) => {
    setFeatures((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const allSelected = columns && features.length === columns.length;

  if (!active) return <NoDataset message="Pick a dataset to train a model." />;

  return (
    <div>
      <PageHeader title="ML Studio" subtitle={active.name} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Brain className="h-4 w-4 text-brand-400" />
            Train model
          </h3>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Target column</label>
              <select
                className="input w-full"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Select target…</option>
                {columns?.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.dtype})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Task</label>
              <select
                className="input w-full"
                value={task}
                onChange={(e) => setTask(e.target.value as any)}
              >
                <option value="auto">Auto-detect</option>
                <option value="regression">Regression</option>
                <option value="classification">Classification</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Model</label>
              <select
                className="input w-full"
                value={modelType}
                onChange={(e) => setModelType(e.target.value)}
              >
                {MODEL_OPTIONS.filter((m) => m.task === "auto" || m.task === task || task === "auto").map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-400">Features</label>
              <div className="flex flex-wrap gap-2">
                <button
                  className="text-xs text-brand-300 hover:text-brand-200"
                  onClick={() => setFeatures(columns?.map((c) => c.name) ?? [])}
                >
                  all
                </button>
                <button
                  className="text-xs text-brand-300 hover:text-brand-200"
                  onClick={() => setFeatures([])}
                >
                  none
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 max-h-40 overflow-y-auto rounded-lg border border-white/10 p-2">
            <div className="flex flex-wrap gap-2">
              {columns?.map((c) => (
                <label
                  key={c.name}
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-xs ${
                    features.includes(c.name)
                      ? "bg-brand-500/20 text-brand-200"
                      : "bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={features.includes(c.name)}
                    onChange={() => toggleFeature(c.name)}
                  />
                  {c.name}
                </label>
              )) ?? <Spinner label="Loading columns…" />}
            </div>
          </div>

          <button
            className="btn-primary mt-4"
            disabled={!target || train.isPending}
            onClick={() => train.mutate()}
          >
            {train.isPending ? <Spinner label="" /> : <Plus className="h-4 w-4" />}
            Train model
          </button>
        </div>

        <div className="card">
          <h3 className="mb-4 text-sm font-semibold text-slate-200">Trained models</h3>
          {modelsLoading ? (
            <Spinner label="Loading models…" />
          ) : !models?.length ? (
            <p className="text-sm text-slate-500">No models trained yet.</p>
          ) : (
            <ul className="space-y-2">
              {models.map((m) => (
                <li
                  key={m.model_id}
                  className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold text-slate-200">{m.model_id}</span>
                    <span className="text-slate-400">{m.task}</span>
                  </div>
                  <div className="mb-2 text-slate-400">
                    target: <span className="text-slate-300">{m.target}</span>
                    <span className="mx-1">|</span>
                    {Object.entries(m.metrics)
                      .map(([k, v]) => `${k}: ${formatMetric(v)}`)
                      .join(" | ")}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn-ghost flex-1 py-1 text-xs"
                      disabled={predict.isPending}
                      onClick={() => predict.mutate(m)}
                    >
                      <Play className="h-3 w-3" />
                      Predict
                    </button>
                    <button
                      className="btn-ghost px-2 py-1 text-xs text-rose-400"
                      disabled={deleteModel.isPending}
                      onClick={() => deleteModel.mutate(m.model_id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {train.data && (
        <div className="card mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">Last training result</h3>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <Metric label="Task" value={train.data.task} />
            <Metric label="Target" value={train.data.target} />
            <Metric label="Rows" value={train.data.rows_used} />
            <Metric label="Features" value={train.data.features.length} />
            {Object.entries(train.data.metrics).map(([k, v]) => (
              <Metric key={k} label={k.toUpperCase()} value={formatMetric(v)} />
            ))}
          </div>
        </div>
      )}

      {predictions && predictModel && (
        <div className="card mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-200">
              Predictions from {predictModel.model_id}
            </h3>
            <span className="text-xs text-slate-400">{predictions.length} row(s)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-900/80">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {predictions[0] &&
                    Object.keys(predictions[0]).map((col) => <th key={col} className="px-3 py-2">{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {predictions.slice(0, 50).map((row, i) => (
                  <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                    {Object.values(row).map((v, j) => (
                      <td key={j} className="px-3 py-2 text-slate-300">
                        {formatValue(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {predictions.length > 50 && (
              <p className="mt-2 text-xs text-slate-500">Showing first 50 rows.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-200">{value}</div>
    </div>
  );
}

function formatMetric(v: number): string {
  if (typeof v !== "number") return String(v);
  if (Math.abs(v) < 0.01) return v.toExponential(2);
  return v.toFixed(4);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(4);
  return String(v);
}
