import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Info, Lightbulb, XCircle } from "lucide-react";

import { NoDataset, PageHeader, Spinner } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { InsightItem } from "@/lib/types";
import { useDataset } from "@/store/dataset";

const SEV = {
  error: { icon: XCircle, className: "border-rose-500/30 bg-rose-500/10 text-rose-300" },
  warning: { icon: AlertTriangle, className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  info: { icon: Info, className: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
} as const;

export default function Insights() {
  const { active } = useDataset();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["insights", active?.id],
    queryFn: () => dataApi.insights(active!.id),
    enabled: !!active,
  });

  if (!active) return <NoDataset message="Pick a dataset to generate auto insights." />;
  if (isLoading) return <Spinner label="Generating insights…" />;
  if (isError || !data) {
    return (
      <div className="glass py-20 text-center">
        <p className="text-lg font-semibold text-rose-400">Failed to load insights</p>
        <button className="btn-ghost mt-3" onClick={() => refetch()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Auto Insights" subtitle={active.name}>
        <button className="btn-ghost" onClick={() => refetch()} disabled={isFetching}>
          <Lightbulb className="h-4 w-4" />
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </PageHeader>

      <div className="card mb-5">
        <p className="text-sm text-slate-300">{data.summary}</p>
        <p className="mt-1 text-xs text-slate-500">{data.insight_count} insight(s)</p>
      </div>

      <div className="grid gap-3">
        {data.insights.map((item) => (
          <InsightCard key={item.id} item={item} />
        ))}
        {data.insights.length === 0 && (
          <div className="card py-10 text-center text-sm text-slate-400">
            No notable insights for this dataset.
          </div>
        )}
      </div>
    </div>
  );
}

function InsightCard({ item }: { item: InsightItem }) {
  const cfg = SEV[item.severity] ?? SEV.info;
  const Icon = cfg.icon;
  return (
    <div className={`rounded-xl border p-4 ${cfg.className}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-slate-100">{item.title}</p>
          <p className="mt-1 text-sm text-slate-300">{item.detail}</p>
        </div>
      </div>
    </div>
  );
}
