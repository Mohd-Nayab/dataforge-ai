import { Database, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
      <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  );
}

export function NoDataset({ message }: { message?: string }) {
  return (
    <div className="glass flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/5">
        <Database className="h-7 w-7 text-brand-400" />
      </div>
      <div>
        <p className="text-lg font-semibold text-slate-100">No dataset selected</p>
        <p className="mt-1 text-sm text-slate-400">
          {message ?? "Upload a file or pick a dataset to get started."}
        </p>
      </div>
      <div className="flex gap-3">
        <Link to="/upload" className="btn-primary">
          Upload data
        </Link>
        <Link to="/datasets" className="btn-ghost">
          Browse datasets
        </Link>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
