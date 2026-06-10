"use client";

import { useState, useMemo } from "react";
import type { WorkflowRun, ViewMode, RunLog } from "@/types/runs";
import type { RunTimelineEventUi } from "@/types/agent-run-ui";
import {
  Check, Copy, Download, Search, Terminal, X, ChevronRight, ChevronDown, Bug,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Level config (dark runtime-console palette) ─────────────────────────────
const LEVEL = {
  debug: { label: "DEBG", fg: "#6B7280", text: "#9CA3AF" },
  info:  { label: "INFO", fg: "#34D399", text: "#D1D5DB" },
  warn:  { label: "WARN", fg: "#FBBF24", text: "#FDE68A" },
  error: { label: "ERRR", fg: "#F87171", text: "#FECACA" },
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

/** Normalize a log line for de-duplication: same second + same words = same event. */
function dedupKey(l: RunLog): string {
  const sec = Math.floor(new Date(l.timestamp ?? 0).getTime() / 1000);
  const msg = (l.message ?? "")
    .toLowerCase()
    .replace(/[—·•|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return `${sec}|${l.level ?? "info"}|${l.stepId ?? ""}|${msg}`;
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return <>
    {parts.map((p, i) =>
      p.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="rounded px-0.5" style={{ background: "#5C4A0E", color: "#FDE68A" }}>{p}</mark>
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
    <div className="group">
      <div
        className="flex cursor-default items-start font-mono transition-colors hover:bg-[#14171A]"
        style={{ fontSize: 12, lineHeight: 1.65 }}
      >
        {/* Line # */}
        <span className="shrink-0 select-none py-1.5 pl-3 pr-3 text-right tabular-nums"
          style={{ width: 48, color: "#374151", fontSize: 10.5 }}>
          {line}
        </span>

        {/* Timestamp */}
        <span className="shrink-0 py-1.5 pr-4 tabular-nums" style={{ color: "#4B5563", minWidth: 92, fontSize: 11 }}>
          {fmtTime(log.timestamp ?? "")}
        </span>

        {/* Level */}
        <span className="shrink-0 select-none py-1.5 pr-3 font-semibold tracking-[0.08em]"
          style={{ color: cfg.fg, width: 46, fontSize: 10.5 }}>
          {cfg.label}
        </span>

        {/* Step */}
        {log.stepId && (
          <span className="shrink-0 truncate py-1.5 pr-3"
            style={{ color: "#5EEAD4", minWidth: 64, maxWidth: 120, fontSize: 11 }}>
            [{log.stepId}]
          </span>
        )}

        {/* Message */}
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words py-1.5 pr-3"
          style={{ color: cfg.text }}>
          <Highlight text={log.message ?? ""} q={q} />
        </span>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1 py-1.5 pr-3 opacity-0 transition-opacity group-hover:opacity-100">
          {hasMeta && (
            <button type="button" onClick={() => setOpen(v => !v)}
              className="flex h-5 w-5 items-center justify-center rounded text-[#6B7280] transition-colors hover:bg-[#1F2428] hover:text-[#D1D5DB]">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
          )}
          <button type="button" onClick={copy}
            className="flex h-5 w-5 items-center justify-center rounded text-[#6B7280] transition-colors hover:bg-[#1F2428] hover:text-[#D1D5DB]">
            {copied ? <Check className="h-3 w-3 text-[#34D399]" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Expanded metadata */}
      {open && hasMeta && (
        <div className="mb-2 ml-[140px] mr-4 overflow-hidden rounded-[8px]"
          style={{ background: "#14171A", border: "1px solid #2A2E33" }}>
          <pre className="max-h-52 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-[#9CA3AF]">
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

  // Merge structured run.logs + raw timeline events into one stream.
  // Events describing the same moment as an existing structured log
  // (same second / level / step / words) are dropped to avoid duplicate lines.
  const allLogs: RunLog[] = useMemo(() => {
    const structured: RunLog[] = run.logs ?? [];
    const existingIds  = new Set(structured.map(l => l.id));
    const existingKeys = new Set(structured.map(dedupKey));

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
    const seenKeys = new Set(existingKeys);
    for (const el of eventLogs) {
      if (existingIds.has(el.id)) continue;
      const key = dedupKey(el);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      combined.push(el);
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
    <div className="overflow-hidden" style={{ borderRadius: "0 0 16px 16px", minHeight: 380, background: "#0B0D0F" }}>

      {/* ── Console toolbar ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5" style={{ borderBottom: "1px solid #1C1F22" }}>

        {/* Identity */}
        <div className="mr-1 flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#6B7280]">
            run-{run.id.slice(0, 8)} · {filtered.length.toLocaleString()} lines
          </span>
        </div>

        {/* Search */}
        <div className="relative min-w-[160px] max-w-xs flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[#4B5563]" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search logs…"
            className="w-full rounded-[8px] py-1.5 pl-8 pr-8 font-mono text-[12px] text-[#D1D5DB] placeholder:text-[#4B5563] focus:outline-none"
            style={{ background: "#14171A", border: "1px solid #2A2E33" }}
            onFocus={e => { e.currentTarget.style.borderColor = "#00A65A"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "#2A2E33"; }}
          />
          {search && (
            <button type="button" onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#D1D5DB]">
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
          const color  = cfg?.fg ?? "#D1D5DB";
          return (
            <button key={l} type="button" onClick={() => setLevel(l)}
              className="flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors"
              style={{
                background: active ? `${color}1a` : "transparent",
                border:     `1px solid ${active ? `${color}55` : "transparent"}`,
                color:      active ? color : "#6B7280",
              }}>
              {cfg && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: active ? color : "#4B5563" }} />}
              {l === "all" ? "All" : cfg!.label}
              <span className="tabular-nums opacity-60">{cnt}</span>
            </button>
          );
        })}

        {/* DEBUG toggle */}
        <button type="button" onClick={() => setShowDebug(v => !v)}
          title={showDebug ? "Hide debug lines" : "Show debug lines"}
          className="flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors"
          style={{
            background: showDebug ? "#34D3991a" : "transparent",
            border:     `1px solid ${showDebug ? "#34D39955" : "#2A2E33"}`,
            color:      showDebug ? "#34D399" : "#6B7280",
          }}>
          <Bug className="h-2.5 w-2.5" />
          Debug
        </button>

        {/* Copy / Export */}
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={copyAll}
            className="flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 font-mono text-[11px] text-[#9CA3AF] transition-colors hover:bg-[#14171A] hover:text-[#D1D5DB]"
            style={{ border: "1px solid #2A2E33" }}>
            {copiedAll ? <Check className="h-3 w-3 text-[#34D399]" /> : <Copy className="h-3 w-3" />}
            Copy all
          </button>
          <button type="button" onClick={download}
            className="flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 font-mono text-[11px] text-[#9CA3AF] transition-colors hover:bg-[#14171A] hover:text-[#D1D5DB]"
            style={{ border: "1px solid #2A2E33" }}>
            <Download className="h-3 w-3" /> Export
          </button>
        </div>
      </div>

      {/* ── Column headers ────────────────────────────────────────────────── */}
      <div className="flex select-none items-center font-mono"
        style={{ borderBottom: "1px solid #1C1F22", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.12em", color: "#4B5563", paddingTop: 6, paddingBottom: 6 }}>
        <span style={{ width: 48, textAlign: "right", paddingRight: 12, paddingLeft: 12 }}>#</span>
        <span style={{ minWidth: 92, paddingRight: 16 }}>Time</span>
        <span style={{ width: 46, paddingRight: 12 }}>Lvl</span>
        <span>Message</span>
      </div>

      {/* ── Log rows ──────────────────────────────────────────────────────── */}
      <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <Terminal className="h-8 w-8 text-[#2A2E33]" />
            <p className="font-mono text-[12px] text-[#6B7280]">
              {search ? `No lines matching "${search}"` : "No log output yet."}
            </p>
          </div>
        ) : (
          filtered.map((log, i) => <LogRow key={log.id} log={log} line={i + 1} q={search} />)
        )}
      </div>

      {/* ── Console footer ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2" style={{ borderTop: "1px solid #1C1F22" }}>
        <span className="font-mono text-[10px] text-[#4B5563]">vectorbea runtime · durable execution</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-[#4B5563]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: counts.error > 0 ? "#F87171" : "#34D399" }} />
          {counts.error > 0 ? `${counts.error} error${counts.error !== 1 ? "s" : ""}` : "no errors"}
        </span>
      </div>
    </div>
  );
}
