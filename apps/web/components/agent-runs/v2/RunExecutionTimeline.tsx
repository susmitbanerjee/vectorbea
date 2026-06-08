"use client";

/**
 * RunExecutionTimeline — Vertical card-based execution trace
 *
 * Replaces the horizontal swimlane dot chart with a debug-friendly
 * vertical list of event cards + a right-side details inspector.
 * UI-only change. No data, API, or business logic modified.
 */

import React, { useMemo, useState } from "react";
import {
  Activity, Bot, BrainCircuit, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Copy, Database, Eye, Globe, Hash, ListFilter, RotateCcw,
  Save, Search, Sparkles, Wrench, X, XCircle, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunTimelineEventUi } from "@/types/agent-run-ui";

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtDur(ms?: number | null): string | null {
  if (!ms) return null;
  if (ms < 1000)   return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function fmtDateTime(ts: string) {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── Display labels ───────────────────────────────────────────────────────────

const LABELS: Record<string, string> = {
  RUN_CREATED: "Run created", RUN_QUEUED: "Run queued", RUN_STARTED: "Run started",
  RUN_SUCCEEDED: "Run succeeded", RUN_FAILED: "Run failed", RUN_CANCELLED: "Run cancelled",
  STEP_SCHEDULED: "Step scheduled", STEP_STARTED: "Step started",
  STEP_COMPLETED: "Step completed", STEP_FAILED: "Step failed", STEP_SKIPPED: "Step skipped",
  STEP_INPUT_RESOLVED: "Inputs resolved", AGENT_STARTED: "Agent started",
  AGENT_COMPLETED: "Agent completed", AGENT_FAILED: "Agent failed", AGENT_HANDOFF: "Agent handoff",
  LLM_CALL_STARTED: "LLM call started", LLM_CALL_COMPLETED: "LLM call completed", LLM_CALL_FAILED: "LLM call failed",
  TOOL_CALL_STARTED: "Tool call started", TOOL_CALL_COMPLETED: "Tool call completed", TOOL_CALL_FAILED: "Tool call failed",
  HTTP_REQUEST_PREPARED: "HTTP request prepared", HTTP_REQUEST_STARTED: "HTTP request started",
  HTTP_REQUEST_COMPLETED: "HTTP request completed",
  DB_QUERY_PREPARED: "DB query prepared", DB_QUERY_STARTED: "DB query started", DB_QUERY_COMPLETED: "DB query completed",
  DB_WRITE_PREPARED: "DB write prepared", DB_WRITE_COMPLETED: "DB write completed",
  APPROVAL_REQUESTED: "Approval requested", APPROVAL_APPROVED: "Approval approved",
  APPROVAL_REJECTED: "Approval rejected", APPROVAL_EXPIRED: "Approval expired",
  CHECKPOINT_CREATED: "Checkpoint saved", RETRY_SCHEDULED: "Retry scheduled",
  RETRY_STARTED: "Retry started", RETRY_EXHAUSTED: "Retries exhausted",
  PARALLEL_STARTED: "Parallel branches started", PARALLEL_BRANCH_STARTED: "Branch started",
  PARALLEL_BRANCH_COMPLETED: "Branch completed", JOIN_WAITING: "Join: waiting",
  JOIN_COMPLETED: "Join: all branches done", CONNECTION_RESOLVED: "Connection resolved",
  TRANSFORM_STARTED: "Transform started", TRANSFORM_COMPLETED: "Transform completed",
  BRANCH_EVALUATED: "Branch evaluated", INPUT_MAPPING_STARTED: "Input mapping",
  INPUT_MAPPING_COMPLETED: "Input mapped", INPUT_MAPPING_FAILED: "Input mapping failed",
  NODE_TYPE_UNSUPPORTED: "Node type unsupported",
};

function displayLabel(type: string) {
  return LABELS[type] ?? type.replace(/_/g, " ").toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

// ─── Category ─────────────────────────────────────────────────────────────────

type Cat = "system" | "step" | "tool" | "http" | "llm" | "approval" | "retry" | "error" | "db";

function categorize(type: string, status: string): Cat {
  if (status === "FAILED") return "error";
  if (type.startsWith("RETRY_")) return "retry";
  if (type.startsWith("APPROVAL_")) return "approval";
  if (type.startsWith("LLM_")) return "llm";
  if (type.startsWith("HTTP_")) return "http";
  if (type.startsWith("DB_")) return "db";
  if (type.startsWith("TOOL_")) return "tool";
  if (/^(STEP_|AGENT_|INPUT_|OUTPUT_|PARALLEL|JOIN|BRANCH|TRANSFORM|CHECKPOINT)/.test(type)) return "step";
  return "system";
}

const CAT: Record<Cat, { label: string; color: string; bg: string; border: string; barColor: string }> = {
  system:   { label: "System",   color: "#475569", bg: "#F8FAFC", border: "#E2E8F0", barColor: "#94A3B8" },
  step:     { label: "Step",     color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE", barColor: "#2563EB" },
  tool:     { label: "Tool",     color: "#0891B2", bg: "#ECFEFF", border: "#A5F3FC", barColor: "#0891B2" },
  http:     { label: "HTTP",     color: "#059669", bg: "#ECFDF5", border: "#A7F3D0", barColor: "#059669" },
  llm:      { label: "LLM",     color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE", barColor: "#7C3AED" },
  approval: { label: "Approval", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A", barColor: "#D97706" },
  retry:    { label: "Retry",    color: "#EA580C", bg: "#FFF7ED", border: "#FED7AA", barColor: "#EA580C" },
  error:    { label: "Error",    color: "#DC2626", bg: "#FEF2F2", border: "#FECACA", barColor: "#EF4444" },
  db:       { label: "DB",       color: "#059669", bg: "#ECFDF5", border: "#A7F3D0", barColor: "#059669" },
};

// ─── Status icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status, type }: { status: string; type: string }) {
  const cat = categorize(type, status);
  const col = CAT[cat].color;
  const cls = "h-[18px] w-[18px] shrink-0";
  const s = status as string;
  if (s === "FAILED") return <XCircle className={cls} style={{ color: "#DC2626" }} />;
  if (s === "WAITING" || s === "PENDING") return <Clock className={cls} style={{ color: "#D97706" }} />;
  if (s === "SUCCEEDED" || s === "ok") return <CheckCircle2 className={cls} style={{ color: "#16A34A" }} />;
  if (type.startsWith("LLM_"))       return <BrainCircuit className={cls} style={{ color: col }} />;
  if (type.startsWith("TOOL_"))      return <Wrench className={cls} style={{ color: col }} />;
  if (type.startsWith("HTTP_"))      return <Globe className={cls} style={{ color: col }} />;
  if (type.startsWith("DB_"))        return <Database className={cls} style={{ color: col }} />;
  if (type.startsWith("APPROVAL_")) return <Eye className={cls} style={{ color: col }} />;
  if (type.startsWith("RETRY_"))    return <RotateCcw className={cls} style={{ color: col }} />;
  if (type.startsWith("CHECKPOINT")) return <Save className={cls} style={{ color: col }} />;
  if (type.startsWith("AGENT_"))    return <Bot className={cls} style={{ color: col }} />;
  return <Hash className={cls} style={{ color: col }} />;
}

// ─── Summary builder ──────────────────────────────────────────────────────────

function buildSummary(e: RunTimelineEventUi): string {
  if (e.summary) return e.summary;
  const dur = fmtDur(e.durationMs);
  const d   = dur ? ` in ${dur}` : "";
  const t   = e.type as string; // cast to string for exhaustive pattern matching
  if (t === "HTTP_REQUEST_COMPLETED")  return `HTTP request completed${d}.`;
  if (t === "LLM_CALL_COMPLETED")      return `LLM completed${d}${e.tokensUsed ? ` · ${e.tokensUsed.toLocaleString()} tokens` : ""}.`;
  if (t === "LLM_CALL_STARTED")        return `LLM call started${e.modelName ? ` (${e.modelName})` : ""}.`;
  if (t === "TOOL_CALL_COMPLETED")     return `Tool call completed${d}.`;
  if (t === "TOOL_CALL_STARTED")       return `Tool call started${e.toolName ? ` — ${e.toolName}` : ""}.`;
  if (t === "APPROVAL_REQUESTED")      return "Waiting for human approval before continuing.";
  if (t === "APPROVAL_APPROVED")       return "Approval received. Continuing workflow.";
  if (t === "APPROVAL_REJECTED")       return "Approval rejected.";
  if (t === "RETRY_SCHEDULED")         return "Retry scheduled after transient failure.";
  if (t === "CHECKPOINT_CREATED")      return "State checkpoint saved.";
  if (t === "STEP_COMPLETED")          return `Step completed${d}.`;
  if (t === "STEP_FAILED")             return "Step failed. See error details.";
  if (t === "AGENT_COMPLETED")         return `Agent completed${d}.`;
  if (t === "RUN_STARTED")             return "Workflow execution started.";
  if (t === "RUN_SUCCEEDED")           return `Workflow completed${d}.`;
  if (t === "RUN_FAILED")              return "Workflow execution failed.";
  if (t === "DB_QUERY_COMPLETED")      return `Database query returned${d}.`;
  if (t === "PARALLEL_STARTED")        return "Starting parallel branch execution.";
  if (t === "JOIN_COMPLETED")          return "All branches complete.";
  return "Event recorded during workflow execution.";
}

// ─── Filter tabs ──────────────────────────────────────────────────────────────

const FILTERS = [
  { id: "all",      label: "All",      match: (_t: string, _s: string) => true },
  { id: "step",     label: "Steps",    match: (t: string) => /^(STEP_|AGENT_|PARALLEL|JOIN)/.test(t) },
  { id: "llm",      label: "LLM",      match: (t: string) => t.startsWith("LLM_") },
  { id: "tool",     label: "Tools",    match: (t: string) => ["tool","http","db"].includes(categorize(t,"")) },
  { id: "approval", label: "Approval", match: (t: string) => t.startsWith("APPROVAL_") },
  { id: "retry",    label: "Retry",    match: (t: string) => t.startsWith("RETRY_") },
  { id: "error",    label: "Errors",   match: (_t: string, s: string) => s === "FAILED" },
] as const;

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  function doCopy() {
    void navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); });
  }
  return (
    <button type="button" onClick={doCopy} className="rounded p-1 text-slate-400 hover:text-slate-600 transition-colors">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ─── Event card ───────────────────────────────────────────────────────────────

function EventCard({ event, selected, onSelect, totalMs, minTs }: {
  event: RunTimelineEventUi; selected: boolean; onSelect: () => void; totalMs: number; minTs: number;
}) {
  const cat  = categorize(event.type, event.status);
  const meta = CAT[cat];
  const dur  = fmtDur(event.durationMs);
  const isFailed  = event.status === "FAILED" || cat === "error";
  const isWaiting = ["WAITING","PENDING"].includes(event.status) || cat === "approval";

  // Duration bar
  const tsMs   = new Date(event.timestamp).getTime() - minTs;
  const barPct = totalMs > 0 ? Math.max(2, Math.min(96, (event.durationMs ?? 0) / totalMs * 100)) : 2;
  const offPct = totalMs > 0 ? Math.min(92, Math.max(0, (tsMs - (event.durationMs ?? 0)) / totalMs * 100)) : 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left group block rounded-xl border transition-all duration-120",
        "hover:border-slate-300 hover:shadow-sm",
        selected
          ? "border-blue-400 bg-blue-50 shadow-[0_0_0_3px_#DBEAFE]"
          : isFailed ? "border-red-200 bg-red-50/50 hover:border-red-300"
          : isWaiting ? "border-amber-200 bg-amber-50/40 hover:border-amber-300"
          : "border-slate-200 bg-white",
      )}
    >
      <div className="px-4 py-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 shrink-0"><StatusIcon status={event.status} type={event.type} /></div>
          <div className="min-w-0 flex-1">
            {/* Title row */}
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("text-[13px] font-semibold leading-tight",
                isFailed ? "text-red-800" : isWaiting ? "text-amber-800" : selected ? "text-blue-800" : "text-slate-800")}>
                {displayLabel(event.type)}
              </span>
              <span className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
                {meta.label}
              </span>
              {(event.toolName || event.agentName || event.modelName) && (
                <span className="rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-600">
                  {event.toolName ?? event.agentName ?? event.modelName}
                </span>
              )}
            </div>
            {/* Summary */}
            <p className={cn("mt-1 text-[12px] leading-relaxed",
              isFailed ? "text-red-600" : isWaiting ? "text-amber-700" : "text-slate-500")}>
              {buildSummary(event)}
            </p>
            {/* Meta chips */}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11.5px] text-slate-500">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtTime(event.timestamp)}</span>
              {dur && <span className="flex items-center gap-1 tabular-nums font-mono"><Zap className="h-3 w-3" />{dur}</span>}
              {(event.tokensUsed ?? 0) > 0 && (
                <span className="flex items-center gap-1 tabular-nums"><Sparkles className="h-3 w-3" />{event.tokensUsed!.toLocaleString()}</span>
              )}
              {event.estimatedCostUsd != null && (
                <span className="tabular-nums font-mono">${(event.estimatedCostUsd ?? 0).toFixed(4)}</span>
              )}
              <span className="ml-auto font-mono text-[10.5px] text-slate-400 tabular-nums">#{event.sequence}</span>
            </div>
            {/* Duration bar */}
            {totalMs > 0 && (
              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full" style={{
                  width: `${barPct}%`, marginLeft: `${offPct}%`,
                  background: isFailed ? "#EF4444" : isWaiting ? "#F59E0B" : meta.barColor, opacity: 0.8,
                }} />
              </div>
            )}
          </div>
          <div className="shrink-0 text-slate-300 group-hover:text-slate-500 mt-0.5">
            {selected ? <ChevronDown className="h-4 w-4 text-blue-500" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── JSON block ───────────────────────────────────────────────────────────────

function JsonBlock({ label, value, open: defaultOpen = false }: { label: string; value: unknown; open?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const json = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const info = typeof value === "object" && value !== null
    ? Array.isArray(value) ? `${(value as unknown[]).length} items` : `${Object.keys(value).length} keys`
    : typeof value;
  return (
    <div>
      <button type="button" onClick={() => setIsOpen(o => !o)}
        className="flex items-center gap-1.5 text-[12px] font-medium text-slate-600 hover:text-slate-900 mb-1">
        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {label} <span className="font-normal text-slate-400 text-[10.5px]">({info})</span>
      </button>
      {isOpen && (
        <div className="relative">
          <pre className="overflow-auto rounded-xl border p-3 text-[11px] font-mono leading-relaxed text-slate-700 max-h-52"
            style={{ background: "#F8FAFC", borderColor: "#E2E8F0" }}>{json}</pre>
          <div className="absolute right-2 top-2"><CopyBtn text={json} /></div>
        </div>
      )}
    </div>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

const DETAIL_TABS = ["Summary","Input","Output","Error","Metadata","Raw"] as const;
type DTab = typeof DETAIL_TABS[number];

function KVRow({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  if (value == null) return null;
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <span className="w-28 shrink-0 text-[11.5px] text-slate-500">{label}</span>
      <span className={cn("min-w-0 flex-1 break-all text-[11.5px] text-slate-800", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">{children}</div>
    </div>
  );
}

function EventDetailPanel({ event, onClose }: { event: RunTimelineEventUi; onClose: () => void }) {
  const cat  = categorize(event.type, event.status);
  const meta = CAT[cat];
  const dur  = fmtDur(event.durationMs);
  const hasInput  = event.inputJson !== undefined;
  const hasOutput = event.outputJson !== undefined;
  const hasError  = !!event.errorMessage || event.status === "FAILED";
  const hasMeta   = event.metadataJson !== undefined;

  const defaultTab: DTab = hasError ? "Error" : "Summary";
  const [tab, setTab] = useState<DTab>(defaultTab);
  React.useEffect(() => { setTab(hasError ? "Error" : "Summary"); }, [event.id, hasError]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5 mb-1">
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
              {meta.label}
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold",
              event.status === "FAILED" ? "bg-red-100 text-red-700 border border-red-200"
              : event.status === "SUCCEEDED" || (event.status as string) === "ok" ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
              : event.status === "WAITING" ? "bg-amber-100 text-amber-700 border border-amber-200"
              : "bg-slate-100 text-slate-600 border border-slate-200")}>
              {event.status}
            </span>
          </div>
          <h3 className="text-[13.5px] font-semibold text-slate-800">{displayLabel(event.type)}</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">{buildSummary(event)}</p>
        </div>
        <button type="button" onClick={onClose}
          className="ml-2 shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 overflow-x-auto border-b border-slate-200 px-4">
        {DETAIL_TABS.map(t => {
          if (t === "Error"    && !hasError)  return null;
          if (t === "Input"    && !hasInput)  return null;
          if (t === "Output"   && !hasOutput) return null;
          if (t === "Metadata" && !hasMeta)   return null;
          return (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={cn("shrink-0 border-b-2 px-3 py-2 text-[12px] font-medium transition-colors",
                tab === t ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800",
                t === "Error" && hasError && tab !== "Error" && "text-red-600")}>
              {t}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 text-[12.5px]">
        {tab === "Summary" && (
          <div className="space-y-4">
            <Section title="Timing">
              <KVRow label="Timestamp" value={fmtDateTime(event.timestamp)} mono />
              {dur && <KVRow label="Duration" value={dur} mono />}
              {event.startedAt  && <KVRow label="Started"  value={fmtDateTime(event.startedAt)}  mono />}
              {event.finishedAt && <KVRow label="Finished" value={fmtDateTime(event.finishedAt)} mono />}
            </Section>
            <Section title="Context">
              <KVRow label="Type"     value={event.type as string} mono />
              <KVRow label="Status"   value={event.status as string} />
              <KVRow label="Sequence" value={`#${event.sequence}`} mono />
              {event.agentName  && <KVRow label="Agent"   value={event.agentName} />}
              {event.toolName   && <KVRow label="Tool"    value={event.toolName} mono />}
              {event.modelName  && <KVRow label="Model"   value={event.modelName} mono />}
              {event.stepName   && <KVRow label="Step"    value={event.stepName} />}
              {event.handoffTo  && <KVRow label="Handoff →" value={event.handoffTo} />}
            </Section>
            {(event.tokensUsed || event.estimatedCostUsd) && (
              <Section title="LLM Metrics">
                {event.tokensUsed      && <KVRow label="Tokens"   value={event.tokensUsed.toLocaleString()} mono />}
                {event.estimatedCostUsd != null && <KVRow label="Est. cost" value={`$${(event.estimatedCostUsd ?? 0).toFixed(6)}`} mono />}
              </Section>
            )}
            {event.approval && (
              <Section title="Approval">
                <KVRow label="Status"  value={event.approval.status} />
                <KVRow label="Title"   value={event.approval.title} />
                {event.approval.message && <KVRow label="Message" value={event.approval.message} />}
                {event.actorName        && <KVRow label="Actor"   value={event.actorName} />}
              </Section>
            )}
          </div>
        )}
        {tab === "Input"    && hasInput  && <JsonBlock label="Input payload"   value={event.inputJson}    open />}
        {tab === "Output"   && hasOutput && <JsonBlock label="Output payload"  value={event.outputJson}   open />}
        {tab === "Metadata" && hasMeta   && <JsonBlock label="Metadata"        value={event.metadataJson} open />}
        {tab === "Error"    && hasError  && (
          <div className="space-y-3">
            {event.errorMessage && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-[12px] font-semibold text-red-800 mb-1">Error message</p>
                <p className="text-[12px] text-red-700 font-mono break-all">{event.errorMessage}</p>
              </div>
            )}
            {!!event.metadataJson && <JsonBlock label="Error metadata" value={event.metadataJson} open />}
          </div>
        )}
        {tab === "Raw" && (
          <div>
            <p className="text-[11px] text-slate-400 mb-2">Full event payload as stored in the event log.</p>
            <JsonBlock label="Raw event" value={event} open />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RunExecutionTimeline({ events }: { events: RunTimelineEventUi[] }) {
  const [selected, setSelected] = useState<RunTimelineEventUi | null>(null);
  const [filter, setFilter]     = useState("all");
  const [search, setSearch]     = useState("");

  const { minTs, totalMs } = useMemo(() => {
    if (!events.length) return { minTs: 0, totalMs: 0 };
    const ts = events.map(e => new Date(e.timestamp).getTime());
    return { minTs: Math.min(...ts), totalMs: Math.max(Math.max(...ts) - Math.min(...ts), 1000) };
  }, [events]);

  const filtered = useMemo(() => {
    let list = events;
    const tab = FILTERS.find(f => f.id === filter);
    if (tab && filter !== "all") list = list.filter(e => tab.match(e.type, e.status));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        displayLabel(e.type).toLowerCase().includes(q) ||
        e.toolName?.toLowerCase().includes(q) ||
        e.agentName?.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.summary?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [events, filter, search]);

  const errorCount = events.filter(e => e.status === "FAILED").length;

  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-slate-200 bg-white">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
          <Activity className="h-6 w-6 text-slate-300" />
        </div>
        <p className="text-[14px] font-semibold text-slate-700">No timeline events yet</p>
        <p className="mt-2 max-w-sm text-[13px] text-slate-400 leading-relaxed">
          When this run starts, Vectorbea will show every step, tool call, approval, retry, and checkpoint here.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white" style={{ boxShadow: "0 2px 8px rgba(15,23,42,0.05)" }}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search events, tools, agents…"
            className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[13px] placeholder:text-slate-400 focus:border-[#9CCFBB] focus:outline-none focus:ring-2 focus:ring-[#E6F4EF] transition-all" />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map(f => {
            const cnt = f.id === "all" ? events.length : events.filter(e => f.match(e.type, e.status)).length;
            if (cnt === 0 && f.id !== "all") return null;
            const active = filter === f.id;
            return (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                className={cn("flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium transition-all",
                  active ? "bg-[#007F4E] text-white shadow-sm"
                  : f.id === "error" && errorCount > 0 ? "bg-red-100 text-red-700 border border-red-200 hover:bg-red-200"
                  : "bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200")}>
                {f.label}
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums",
                  active ? "bg-[#00A65A] text-white" : "bg-white text-slate-500")}>{cnt}</span>
              </button>
            );
          })}
        </div>
        <span className="ml-auto text-[12px] text-slate-400 tabular-nums">{filtered.length} of {events.length}</span>
      </div>

      {/* Split layout */}
      <div className="flex min-h-[480px] divide-x divide-slate-200">
        {/* Left: event list */}
        <div className={cn("overflow-y-auto", selected ? "w-[65%]" : "w-full")}>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ListFilter className="mb-3 h-8 w-8 text-slate-300" />
              <p className="text-[13px] font-medium text-slate-600">No events match</p>
              <p className="mt-1 text-[12px] text-slate-400">Try changing the filter or search.</p>
              <button type="button" onClick={() => { setFilter("all"); setSearch(""); }}
                className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="space-y-1 p-3">
              {filtered.map(e => (
                <EventCard key={e.id} event={e} selected={selected?.id === e.id}
                  onSelect={() => setSelected(prev => prev?.id === e.id ? null : e)}
                  totalMs={totalMs} minTs={minTs} />
              ))}
            </div>
          )}
        </div>

        {/* Right: details */}
        {selected ? (
          <div className="w-[35%] min-w-[280px] shrink-0 overflow-hidden">
            <EventDetailPanel event={selected} onClose={() => setSelected(null)} />
          </div>
        ) : (
          <div className="hidden w-[32%] shrink-0 flex-col items-center justify-center p-8 text-center lg:flex">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50">
              <Eye className="h-5 w-5 text-slate-300" />
            </div>
            <p className="text-[13px] font-semibold text-slate-600">Select an event</p>
            <p className="mt-1.5 text-[12px] text-slate-400 leading-relaxed">
              Click any event to inspect input, output, error, and raw payload.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
