"use client";

import { useState, useMemo } from "react";
import type { WorkflowRun, ViewMode, RunLog } from "@/types/runs";
import type { RunTimelineEventUi } from "@/types/agent-run-ui";
import {
  Check, Copy, Download, Search, FileText, Filter, X, ChevronRight, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Level config (light-mode palette) ───────────────────────────────────────
const LEVEL = {
  debug: { label: "DEBG", fg: "#64748B", bg: "#F8FAFC", border: "#E2E8F0", dot: "#94A3B8", text: "#475569" },
  info:  { label: "INFO", fg: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE", dot: "#3B82F6", text: "#1E40AF" },
  warn:  { label: "WARN", fg: "#D97706", bg: "#FFFBEB", border: "#FDE68A", dot: "#F59E0B", text: "#92400E" },
  error: { label: "ERRR", fg: "#DC2626", bg: "#FEF2F2", border: "#FECACA", dot: "#EF4444", text: "#991B1B" },
} as const;
type Level = keyof typeof LEVEL;

function fmtTime(ts: string): string {
  try {
    const d = new Date(ts);
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  } catch { return ts.slice(11, 23) || ts; }
}
function isoTs(ts: string): string {
  try { return new Date(ts).toISOString(); } catch { return ts; }
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return <>
    {parts.map((p, i) =>
      p.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="rounded px-0.5" style={{ background: "#FEF08A", color: "#713F12" }}>{p}</mark>
        : p
    )}
  </>;
}

// ─── Single log row ───────────────────────────────────────────────────────────
function LogRow({ log, line, q }: { log: RunLog; line: number; q: string }) {
  const [open, setOpen]   = useState(false);
  const [copied, setCopy] = useState(false);
  const lv  = (log.level ?? "info") as Level;
  const cfg = LEVEL[lv] ?? LEVEL.info;
  const hasMeta = log.metadata && Object.keys(log.metadata).filter(k => log.metadata![k] != null && log.metadata![k] !== "").length > 0;

  function copy() {
    const t = `${isoTs(log.timestamp ?? "")} [${cfg.label}] ${log.stepId ? `[${log.stepId}] ` : ""}${log.message}`;
    void navigator.clipboard.writeText(t);
    setCopy(true); setTimeout(() => setCopy(false), 1500);
  }

  return (
    <div className="group" style={{ borderBottom: "1px solid #F1F5F9" }}>
      <div
        className="flex items-start gap-0 font-mono cursor-default transition-colors hover:bg-slate-50"
        style={{ fontSize: 12.5, lineHeight: 1.6 }}
      >
        {/* Line # */}
        <span className="shrink-0 select-none text-right pr-3 pl-3 py-2"
          style={{ width: 48, color: "#CBD5E1", fontSize: 10.5 }}>
          {line}
        </span>

        {/* Timestamp */}
        <span className="shrink-0 pr-4 py-2 tabular-nums" style={{ color: "#94A3B8", minWidth: 90, fontSize: 11.5 }}>
          {fmtTime(log.timestamp ?? "")}
        </span>

        {/* Level badge */}
        <span className="shrink-0 mr-3 py-2 flex items-start pt-[9px]">
          <span className="rounded px-1.5 py-0.5 text-[9.5px] font-black tracking-widest"
            style={{ background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.border}` }}>
            {cfg.label}
          </span>
        </span>

        {/* Step */}
        {log.stepId && (
          <span className="shrink-0 pr-3 py-2 truncate"
            style={{ color: "#94A3B8", minWidth: 80, maxWidth: 120, fontSize: 11 }}>
            [{log.stepId}]
          </span>
        )}

        {/* Message */}
        <span className="flex-1 min-w-0 pr-3 py-2 break-words whitespace-pre-wrap"
          style={{ color: cfg.text }}>
          <Highlight text={log.message ?? ""} q={q} />
        </span>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1 pr-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {hasMeta && (
            <button type="button" onClick={() => setOpen(v => !v)}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-slate-200 transition-colors text-slate-400">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
          <button type="button" onClick={copy}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-slate-200 transition-colors text-slate-400">
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Expanded metadata */}
      {open && hasMeta && (
        <div className="ml-[232px] mr-4 mb-2 rounded-lg overflow-hidden"
          style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
          <pre className="font-mono text-[11px] leading-relaxed overflow-auto max-h-52 p-3 text-slate-600">
            {JSON.stringify(
              Object.fromEntries(Object.entries(log.metadata ?? {}).filter(([, v]) => v != null && v !== "")),
              null, 2
            )}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface LogsTabProps {
  run: WorkflowRun;
  viewMode: ViewMode;
  rawEvents?: RunTimelineEventUi[];
}

export function LogsTab({ run, viewMode, rawEvents }: LogsTabProps) {
  const [search, setSearch]       = useState("");
  const [levelFilter, setLevel]   = useState("all");
  const [showDebug, setShowDebug] = useState(true);
  const [copiedAll, setCopiedAll] = useState(false);

  // Merge structured run.logs + raw timeline events into unified stream
  const allLogs: RunLog[] = useMemo(() => {
    const structured: RunLog[] = run.logs ?? [];
    const existingIds = new Set(structured.map(l => l.id));

    const eventLogs: RunLog[] = (rawEvents ?? []).map(ev => ({
      id:        `evt-${ev.id}`,
      timestamp: ev.timestamp,
      level:     (ev.status === "FAILED"           ? "error"
                : ev.type?.includes("RETRY")       ? "warn"
                : ev.type?.includes("ERROR")       ? "error"
                : "info") as RunLog["level"],
      stepId:    ev.stepId,
      message: [
        ev.title,
        ev.summary,
        ev.errorMessage,
        ev.agentName        && `agent=${ev.agentName}`,
        ev.toolName         && `tool=${ev.toolName}`,
        ev.modelName        && `model=${ev.modelName}`,
        ev.tokensUsed       && `tokens=${ev.tokensUsed.toLocaleString()}`,
        ev.estimatedCostUsd && `cost=$${ev.estimatedCostUsd.toFixed(5)}`,
        ev.durationMs       && `duration=${ev.durationMs}ms`,
      ].filter(Boolean).join("  ·  "),
      metadata: Object.fromEntries(
        Object.entries({
          type:            ev.type,
          status:          ev.status,
          source:          ev.source,
          agentName:       ev.agentName,
          toolName:        ev.toolName,
          modelName:       ev.modelName,
          tokensUsed:      ev.tokensUsed,
          estimatedCostUsd:ev.estimatedCostUsd,
          durationMs:      ev.durationMs,
          error:           ev.errorMessage,
          inputKeys:  ev.inputJson  ? Object.keys(ev.inputJson  as object).join(", ") : undefined,
          outputKeys: ev.outputJson ? Object.keys(ev.outputJson as object).join(", ") : undefined,
        }).filter(([, v]) => v != null && v !== "")
      ),
    }));

    const combined = [...structured];
    for (const el of eventLogs) {
      if (!existingIds.has(el.id)) combined.push(el);
    }
    return combined.sort((a, b) =>
      new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime()
    );
  }, [run.logs, rawEvents]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const l of allLogs) { c[l.level] = (c[l.level] ?? 0) + 1; }
    return c;
  }, [allLogs]);

  const filtered = useMemo(() => {
    let items = allLogs;
    if (!showDebug)            items = items.filter(l => l.level !== "debug");
    if (levelFilter !== "all") items = items.filter(l => l.level === levelFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(l =>
        l.message?.toLowerCase().includes(q) ||
        l.stepId?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [allLogs, showDebug, levelFilter, search]);

  function copyAll() {
    const t = filtered.map((l, i) =>
      `${String(i + 1).padStart(5)} ${isoTs(l.timestamp ?? "")} [${(l.level ?? "info").toUpperCase().padEnd(5)}]` +
      `${l.stepId ? ` [${l.stepId}]` : ""} ${l.message}`
    ).join("\n");
    void navigator.clipboard.writeText(t);
    setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1500);
  }

  function download() {
    const header = [
      `# Vectorbea Run Log`,
      `# Run:      ${run.id}`,
      `# Workflow: ${run.workflowName} v${run.workflowVersion}`,
      `# Status:   ${run.status}`,
      `# Started:  ${run.startedAt}`,
      `# Duration: ${run.durationMs}ms`,
      `# Tokens:   ${run.totalTokens ?? 0}`,
      `# Cost:     $${run.totalCostUsd?.toFixed(4) ?? "0"}`,
      `# Exported: ${new Date().toISOString()}`,
      `# Lines:    ${filtered.length}`,
      "", "",
    ].join("\n");

    const body = filtered.map((l, i) => {
      const main = `${String(i + 1).padStart(5)} ${isoTs(l.timestamp ?? "")} [${(l.level ?? "").toUpperCase().padEnd(5)}]${l.stepId ? ` [${l.stepId}]` : ""} ${l.message}`;
      const meta = l.metadata && Object.keys(l.metadata).length > 0
        ? `            metadata=${JSON.stringify(l.metadata)}` : "";
      return meta ? `${main}\n${meta}` : main;
    }).join("\n");

    const blob = new Blob([header + body], { type: "text/plain;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `run-${run.id.slice(0, 8)}.log`,
    });
    a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="bg-white" style={{ borderRadius: "0 0 16px 16px", minHeight: 380 }}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-slate-100"
        style={{ background: "#F8FAFC" }}>

        {/* Icon + label */}
        <div className="flex items-center gap-1.5 mr-1">
          <FileText className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
            {run.id.slice(0, 8)} · {filtered.length.toLocaleString()} lines
          </span>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search logs…"
            className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-8 py-1.5 text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Level filters */}
        {(["all", "error", "warn", "info", "debug"] as const).map(l => {
          const active = levelFilter === l;
          const cfg    = l !== "all" ? LEVEL[l] : null;
          const cnt    = l === "all" ? allLogs.length : (counts[l] ?? 0);
          if (cnt === 0 && l !== "all" && l !== levelFilter) return null;
          return (
            <button key={l} type="button" onClick={() => setLevel(l)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-all"
              style={{
                background: active ? (cfg?.bg ?? "#F1F5F9") : "transparent",
                border:     `1px solid ${active ? (cfg?.border ?? "#E2E8F0") : "transparent"}`,
                color:      active ? (cfg?.fg ?? "#64748B") : "#94A3B8",
              }}>
              {cfg && <span className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: active ? cfg.dot : "#CBD5E1" }} />}
              {l === "all" ? "All" : cfg!.label}
              <span className="opacity-60 ml-0.5">{cnt}</span>
            </button>
          );
        })}

        {/* DEBUG toggle */}
        <button type="button" onClick={() => setShowDebug(v => !v)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all"
          style={{
            background: showDebug ? "#F0FDF4" : "transparent",
            border:     `1px solid ${showDebug ? "#BBF7D0" : "transparent"}`,
            color:      showDebug ? "#16A34A" : "#94A3B8",
          }}>
          <Filter className="h-2.5 w-2.5" />
          Debug
        </button>

        {/* Copy / Download */}
        <div className="flex items-center gap-1.5 ml-auto">
          <button type="button" onClick={copyAll}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-medium text-slate-500 hover:bg-slate-50 transition-colors">
            {copiedAll ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            Copy all
          </button>
          <button type="button" onClick={download}
            className="flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11.5px] font-medium text-slate-500 hover:bg-slate-50 transition-colors">
            <Download className="h-3 w-3" /> Export
          </button>
        </div>
      </div>

      {/* ── Column headers ────────────────────────────────────────────────── */}
      <div className="flex items-center select-none border-b border-slate-100"
        style={{ background: "#FAFAFA", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#CBD5E1", paddingTop: 5, paddingBottom: 5 }}>
        <span style={{ width: 48, textAlign: "right", paddingRight: 12, paddingLeft: 12 }}>#</span>
        <span style={{ minWidth: 90, paddingRight: 16, fontFamily: "monospace" }}>Time</span>
        <span style={{ width: 52, marginRight: 12 }}>Level</span>
        <span>Message</span>
      </div>

      {/* ── Log rows ──────────────────────────────────────────────────────── */}
      <div className="overflow-y-auto" style={{ maxHeight: 520, fontFamily: "'SF Mono','Fira Code','Cascadia Code',ui-monospace,monospace" }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <FileText className="h-8 w-8 text-slate-200" />
            <p className="text-[12px] text-slate-400">
              {search ? `No lines matching "${search}"` : "No log output yet."}
            </p>
          </div>
        ) : (
          filtered.map((log, i) => <LogRow key={log.id} log={log} line={i + 1} q={search} />)
        )}
      </div>
    </div>
  );
}
