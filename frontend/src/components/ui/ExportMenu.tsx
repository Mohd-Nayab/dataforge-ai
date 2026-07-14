import { Download, FileJson, FileSpreadsheet, FileText, FileBarChart } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { dataApi } from "@/lib/api";

const FORMATS = [
  { format: "csv", label: "CSV (.csv)", icon: FileText },
  { format: "xlsx", label: "Excel (.xlsx)", icon: FileSpreadsheet },
  { format: "json", label: "JSON (.json)", icon: FileJson },
] as const;

const REPORT_FORMATS = [
  { format: "html", label: "Enterprise Report (HTML)", icon: FileText },
  { format: "xlsx", label: "Enterprise Report (Excel)", icon: FileBarChart },
] as const;

export default function ExportMenu({ datasetId }: { datasetId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function handle(format: "csv" | "xlsx" | "json") {
    try {
      await dataApi.download(datasetId, format);
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch {
      toast.error(`Failed to export as ${format.toUpperCase()}`);
    }
    setOpen(false);
  }

  async function handleReport(format: "html" | "xlsx") {
    try {
      await dataApi.downloadEnterpriseReport(datasetId, format);
      toast.success(`Downloaded enterprise report (${format.toUpperCase()})`);
    } catch {
      toast.error(`Failed to download enterprise report`);
    }
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button className="btn-ghost" onClick={() => setOpen((o) => !o)}>
        <Download className="h-4 w-4" /> Export
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-slate-900/95 p-1 shadow-xl backdrop-blur">
          {FORMATS.map(({ format, label, icon: Icon }) => (
            <button
              key={format}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
              onClick={() => handle(format)}
            >
              <Icon className="h-4 w-4 text-brand-400" />
              {label}
            </button>
          ))}
          <div className="my-1 border-t border-white/10" />
          <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Enterprise Reports
          </div>
          {REPORT_FORMATS.map(({ format, label, icon: Icon }) => (
            <button
              key={format}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
              onClick={() => handleReport(format)}
            >
              <Icon className="h-4 w-4 text-brand-400" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
