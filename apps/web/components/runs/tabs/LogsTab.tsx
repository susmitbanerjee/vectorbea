"use client";
import { useState, useMemo } from "react";
import type { WorkflowRun, ViewMode } from "@/types/runs";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const LEVEL_STYLE = {
  debug: { text: "#94A3B8", bg: "#F8FAFC", label: "DEBUG" },
  info:  { text: "#2563EB", bg: "#EFF6FF", label: "INFO" },
  warn:  { text: "#D97706", bg: "#FFFBEB", label: "WARN" },
  error: { text: "#B91C1C", bg: "#FEF2F2", label: "ERROR" },
};

export function LogsTab({ run, viewMode }: { run: WorkflowRun; viewMode: ViewMode }) {
  const [search, setSearch]   = useState("");
  const [level, setLevel]     = useState<string>("all");
  const [stepFilter, setStep] = useState<string>("all");

  const logs = useMemo(() => {
    let items = run.logs;
    if (viewMode === "business") items = items.filter(l => l.level !== "debug");
    if (level !== "all") items = items.filter(l => l.level === level);
    if (stepFilter !== "all") items = items.filter(l => l.stepId === stepFilter);
    if (search) items = items.filter(l => l.message.toLowerCase().includes(search.toLowerCase()));
    return items;
  }, [run.logs, viewMode, level, stepFilter, search]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search logs…"
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-[13px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
        </div>
        {["all","debug","info","warn","error"].map(l => (
          <button key={l} type="button" onClick={() => setLevel(l)}
            className={cn("h-9 rounded-xl border px-3 text-[12.5px] font-semibold transition-colors",
              level === l ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            )}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Log rows */}
      {logs.length === 0 ? (
        <div className="py-12 text-center text-slate-400" style={{ fontSize: 13 }}>No logs match your filters.</div>
      ) : (
        <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
          {logs.map(log => {
            const s = LEVEL_STYLE[log.level];
            const time = new Date(log.timestamp).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
            return (
              <div key={log.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                <span className="shrink-0 font-mono" style={{ fontSize: 11, color: "#94A3B8", minWidth: 64, marginTop: 1 }}>{time}</span>
                <span className="shrink-0 rounded px-1.5 py-px font-mono text-[9px] font-bold" style={{ background: s.bg, color: s.text, marginTop: 1 }}>
                  {s.label}
                </span>
                <span className="flex-1 min-w-0" style={{ fontSize: 12.5, color: "#334155", lineHeight: 1.5 }}>{log.message}</span>
                {log.stepId && (
                  <span className="shrink-0 font-mono" style={{ fontSize: 10, color: "#94A3B8" }}>{log.stepId}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
