"use client";

/**
 * LogsTab — professional terminal-style log viewer for engineers.
 * Dark terminal UI · monospace · ms-precision timestamps · expandable metadata
 * Inspired by kubectl logs, AWS CloudWatch, Datadog Live Tail.
 */

import { useState, useMemo, useRef } from "react";
import type { WorkflowRun, ViewMode, RunLog } from "@/types/runs";
import type { RunTimelineEventUi } from "@/types/agent-run-ui";
import {
  Check, Copy, Download, Search, Terminal, Filter, X, ChevronRight, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Level config ─────────────────────────────────────────────────────────────
const LEVEL = {
  debug: { label: "DEBG", fg: "#94A3B8", bg: "#0F172A",  border: "#1E293B",  dot: "#475569" },
  info:  { label: "INFO", fg: "#60A5FA", bg: "#0C1A2E",  border: "#1D3A5E",  dot: "#3B82F6" },
  warn:  { label: "WARN", fg: "#FCD34D", bg: "#1C1200",  border: "#3D2900",  dot: "#F59E0B" },
  error: { label: "ERRR", fg: "#F87171", bg: "#200000",  border: "#3D0000",  dot: "#EF4444" },
} as const;
type Level = keyof typeof LEVEL;

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
        ? <mark key={i} style={{ background: "#FEF08A55", color: "#FEF08A", borderRadius: 2, padding: "0 2px" }}>{p}</mark>
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
    <div className="group" style={{ borderBottom: "1px solid #111827" }}>
      <div
        className="flex items-start gap-0 font-mono cursor-default transition-colors"
        style={{ fontSize: 12.5, lineHeight: 1.6 }}
        onMouseEnter={e => { if (!open) (e.currentTarget as HTMLElement).style.background = "#111827"; }}
        onMouseLeave={e => { if (!open) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        {/* Line # */}
        <span className="shrink-0 select-none text-right pr-3 pl-3 py-2"
          style={{ width: 52, color: "#1E3A5F", fontSize: 10.5 }}>{line}</span>

        {/* Timestamp */}
        <span className="shrink-0 pr-4 py-2" style={{ color: "#4B5563", minWidth: 96, letterSpacing: "0.01em" }}>
          {fmtTime(log.timestamp ?? "")}
        </span>

        {/* Level */}
        <span className="shrink-0 mr-3 py-2" style={{ paddingTop: 8 }}>
          <span className="rounded px-1.5 py-0.5 text-[9.5px] font-black tracking-widest"
            style={{ background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.border}` }}>
            {cfg.label}
          </span>
        </span>

        {/* Step */}
        <span className="shrink-0 pr-3 py-2 truncate"
          style={{ color: "#374151", minWidth: 90, maxWidth: 130, fontSize: 11, opacity: log.stepId ? 1 : 0 }}>
          {log.stepId ? `[${log.stepId}]` : "—"}
        </span>

        {/* Message */}
        <span className="flex-1 min-w-0 pr-3 py-2 break-words whitespace-pre-wrap"
          style={{ color: lv === "error" ? "#FCA5A5" : lv === "warn" ? "#FDE68A" : "#CBD5E1" }}>
          <Highlight text={log.message ?? ""} q={q} />
        </span>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1 pr-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {hasMeta && (
            <button type="button" onClick={() => setOpen(v => !v)}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-slate-700 transition-colors"
              style={{ color: "#4B5563" }}>
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
          <button type="button" onClick={copy}
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-slate-700 transition-colors"
            style={{ color: "#4B5563" }}>
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Expanded metadata */}
      {open && hasMeta && (
        <div className="ml-[340px] mr-4 pb-3" style={{ background: cfg.bg, borderTop: `1px solid ${cfg.border}` }}>
          <pre className="font-mono text-[11px] leading-relaxed overflow-auto max-h-56 pt-2 px-2"
            style={{ color: "#6B7280", background: "transparent" }}>
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
  const [showDebug, setShowDebug] = useState(viewMode !== "business");
  const [copiedAll, setCopiedAll] = useState(false);

  // Merge structured run.logs + raw timeline events into unified stream
  const allLogs: RunLog[] = useMemo(() => {
    const structured: RunLog[] = run.logs ?? [];
    const existingIds = new Set(structured.map(l => l.id));

    // Convert raw events to log lines (engineers want to see every event)
    const eventLogs: RunLog[] = (rawEvents ?? []).map(ev => ({
      id:        `evt-${ev.id}`,
      timestamp: ev.timestamp,
      level:     (ev.status === "FAILED" ? "error"
                : ev.type?.includes("RETRY") ? "warn"
                : ev.type?.includes("ERROR") ? "error"
                : "info") as RunLog["level"],
      stepId:    ev.stepId,
      message: [
        ev.title,
        ev.summary,
        ev.errorMessage,
        ev.agentName    && `agent=${ev.agentName}`,
        ev.toolName     && `tool=${ev.toolName}`,
        ev.modelName    && `model=${ev.modelName}`,
        ev.tokensUsed   && `tokens=${ev.tokensUsed.toLocaleString()}`,
        ev.estimatedCostUsd && `cost=$${ev.estimatedCostUsd.toFixed(5)}`,
        ev.durationMs   && `duration=${ev.durationMs}ms`,
      ].filter(Boolean).join("  ·  "),
      metadata: Object.fromEntries(
        Object.entries({
          type:       ev.type,
          status:     ev.status,
          source:     ev.source,
          agentName:  ev.agentName,
          toolName:   ev.toolName,
          modelName:  ev.modelName,
          tokensUsed: ev.tokensUsed,
          estimatedCostUsd: ev.estimatedCostUsd,
          durationMs: ev.durationMs,
          error:      ev.errorMessage,
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

  // Per-level counts
  const counts = useMemo(() => {
    const c: Record<string, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    for (const l of allLogs) { c[l.level] = (c[l.level] ?? 0) + 1; }
    return c;
  }, [allLogs]);

  // Filtered
  const filtered = useMemo(() => {
    let items = allLogs;
    if (!showDebug)              items = items.filter(l => l.level !== "debug");
    if (levelFilter !== "all")   items = items.filter(l => l.level === levelFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(l =>
        l.message?.toLowerCase().includes(q) ||
        l.stepId?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [allLogs, showDebug, levelFilter, search]);

  // Copy all
  function copyAll() {
    const t = filtered.map((l, i) =>
      `${String(i + 1).padStart(5)} ${isoTs(l.timestamp ?? "")} [${(l.level ?? "info").toUpperCase().padEnd(5)}]` +
      `${l.stepId ? ` [${l.stepId}]` : ""} ${l.message}`
    ).join("\n");
    void navigator.clipboard.writeText(t);
    setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1500);
  }

  // Download
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
    <div style={{ background: "#0D1117", borderRadius: "0 0 16px 16px", minHeight: 400 }}>

      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5"
        style={{ borderBottom: "1px solid #161B22", background: "#010409" }}>

        <div className="flex items-center gap-1.5 mr-1">
          <Terminal className="h-3.5 w-3.5" style={{ color: "#30363D" }} />
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest" style={{ color: "#30363D" }}>
            stdout · {run.id.slice(0, 8)}
          </span>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2" style={{ color: "#30363D" }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="grep…"
            style={{
              height: 30, width: "100%", paddingLeft: 28, paddingRight: 8,
              background: "#161B22", border: "1px solid #30363D",
              borderRadius: 8, color: "#C9D1D9", fontSize: 12,
              fontFamily: "monospace", outline: "none",
            }}
          />
          {search && (
            <button type="button" onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2" style={{ color: "#30363D" }}>
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Level filters */}
        {(["all", "error", "warn", "info", "debug"] as const).map(l => {
          const active = levelFilter === l;
          const cfg    = l !== "all" ? LEVEL[l] : null;
          const cnt    = l === "all" ? allLogs.length : counts[l] ?? 0;
          if (cnt === 0 && l !== "all" && l !== levelFilter) return null;
          return (
            <button key={l} type="button" onClick={() => setLevel(l)}
              className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-all"
              style={{
                background: active ? (cfg?.bg ?? "#161B22") : "transparent",
                border: `1px solid ${active ? (cfg?.border ?? "#30363D") : "transparent"}`,
                color: active ? (cfg?.fg ?? "#8B949E") : "#484F58",
              }}>
              {cfg && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: active ? cfg.dot : "#30363D" }} />}
              {l === "all" ? "ALL" : cfg!.label}
              <span style={{ opacity: 0.6, marginLeft: 2 }}>{cnt}</span>
            </button>
          );
        })}

        {/* DEBUG toggle */}
        <button type="button" onClick={() => setShowDebug(v => !v)}
          className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold transition-all"
          style={{
            background: showDebug ? "#0D2818" : "transparent",
            border: `1px solid ${showDebug ? "#1A4D2E" : "#30363D"}`,
            color: showDebug ? "#3FB950" : "#484F58",
          }}>
          <Filter className="h-2.5 w-2.5" />
          DEBUG
        </button>

        <span className="font-mono text-[10px]" style={{ color: "#484F58" }}>
          {filtered.length.toLocaleString()} lines
        </span>

        <div className="flex items-center gap-1 ml-auto">
          <button type="button" onClick={copyAll}
            className="flex h-7 items-center gap-1 rounded px-2.5 font-mono text-[10.5px] transition-colors"
            style={{ background: "#161B22", border: "1px solid #30363D", color: "#8B949E" }}>
            {copiedAll ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            Copy
          </button>
          <button type="button" onClick={download}
            className="flex h-7 items-center gap-1 rounded px-2.5 font-mono text-[10.5px] transition-colors"
            style={{ background: "#161B22", border: "1px solid #30363D", color: "#8B949E" }}>
            <Download className="h-3 w-3" /> .log
          </button>
        </div>
      </div>

      {/* ── Column header ────────────────────────────────────────────── */}
      <div className="flex items-center font-mono select-none"
        style={{ background: "#010409", borderBottom: "1px solid #161B22", color: "#30363D", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.1em", paddingTop: 4, paddingBottom: 4 }}>
        <span style={{ width: 52, textAlign: "right", paddingRight: 12, paddingLeft: 12 }}>#</span>
        <span style={{ minWidth: 96, paddingRight: 16 }}>Time</span>
        <span style={{ width: 52, marginRight: 12 }}>Level</span>
        <span style={{ minWidth: 90, maxWidth: 130, paddingRight: 12 }}>Step</span>
        <span>Message</span>
      </div>

      {/* ── Rows ─────────────────────────────────────────────────────── */}
      <div className="overflow-y-auto" style={{ maxHeight: 600, fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace" }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Terminal className="h-8 w-8" style={{ color: "#161B22" }} />
            <p className="font-mono text-[11px]" style={{ color: "#30363D" }}>
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
