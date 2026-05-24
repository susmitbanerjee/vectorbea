"use client";

import React, { useState, useMemo } from "react";
import { Search, X, AlignLeft, AlignJustify } from "lucide-react";
import type { RunTimelineEventUi, TimelineEventType } from "@/types/agent-run-ui";

// ─── Timestamp formatter ──────────────────────────────────────────────────────

function fmtTs(ts: string) {
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }) +
    " UTC " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
  );
}

function fmtDur(ms?: number) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ─── Event config: icon glyph + dot color per type ───────────────────────────

type EventMeta = { glyph: string; dotColor: string; label: string };

function getEventMeta(type: TimelineEventType, status: string): EventMeta {
  const dotByStatus: Record<string, string> = {
    SUCCEEDED: "#059669",
    FAILED:    "#DC2626",
    RUNNING:   "#2563EB",
    WAITING:   "#D97706",
    PENDING:   "#6B7280",
    CANCELLED: "#475569",
    SKIPPED:   "#334155",
  };

  const dotColor = dotByStatus[status] ?? "#475569";

  const glyphMap: Partial<Record<TimelineEventType, string>> = {
    RUN_CREATED: "⊕", RUN_QUEUED: "○", RUN_STARTED: "▶", RUN_PAUSED: "⏸",
    RUN_RESUMED: "▶", RUN_SUCCEEDED: "✓", RUN_FAILED: "✕", RUN_CANCELLED: "⊘",
    RUN_TIMED_OUT: "⏱", BUDGET_CHECK_PASSED: "$", BUDGET_CHECK_FAILED: "$",
    POLICY_CHECK_PASSED: "✓", POLICY_CHECK_FAILED: "✕",
    AGENT_SELECTED: "◈", AGENT_STARTED: "◈", AGENT_PLAN_CREATED: "◈",
    AGENT_HANDOFF: "⇢", AGENT_COMPLETED: "◈", AGENT_FAILED: "◈",
    STEP_STARTED: "◇", STEP_COMPLETED: "◇", STEP_FAILED: "◇",
    LLM_CALL_STARTED: "⚡", LLM_CALL_COMPLETED: "⚡", LLM_CALL_FAILED: "⚡",
    LLM_OUTPUT_VALIDATED: "⚡",
    TOOL_CALL_STARTED: "⬡", TOOL_CALL_COMPLETED: "⬡", TOOL_CALL_FAILED: "⬡",
    HTTP_CALL_STARTED: "⇄", HTTP_CALL_COMPLETED: "⇄", HTTP_CALL_FAILED: "⇄",
    APPROVAL_REQUESTED: "◉", APPROVAL_APPROVED: "◉", APPROVAL_REJECTED: "◉",
    APPROVAL_EXPIRED: "◉",
    RETRY_SCHEDULED: "↺", RETRY_STARTED: "↺", RETRY_EXHAUSTED: "↺",
    ARTIFACT_CREATED: "⬟",
  };

  const labelMap: Partial<Record<TimelineEventType, string>> = {
    RUN_CREATED: "Run Created", RUN_QUEUED: "Run Queued", RUN_STARTED: "Run Started",
    RUN_PAUSED: "Run Paused", RUN_RESUMED: "Run Resumed", RUN_SUCCEEDED: "Run Succeeded",
    RUN_FAILED: "Run Failed", RUN_CANCELLED: "Run Cancelled", RUN_TIMED_OUT: "Run Timed Out",
    BUDGET_CHECK_PASSED: "Budget Check Passed", BUDGET_CHECK_FAILED: "Budget Check Failed",
    POLICY_CHECK_PASSED: "Policy Check Passed", POLICY_CHECK_FAILED: "Policy Check Failed",
    AGENT_SELECTED: "Agent Selected", AGENT_STARTED: "Agent Started",
    AGENT_PLAN_CREATED: "Agent Plan Created", AGENT_HANDOFF: "Agent Handoff",
    AGENT_COMPLETED: "Agent Completed", AGENT_FAILED: "Agent Failed",
    STEP_STARTED: "Step Started", STEP_COMPLETED: "Step Completed", STEP_FAILED: "Step Failed",
    LLM_CALL_STARTED: "LLM Call Started", LLM_CALL_COMPLETED: "LLM Call Completed",
    LLM_CALL_FAILED: "LLM Call Failed", LLM_OUTPUT_VALIDATED: "LLM Output Validated",
    TOOL_CALL_STARTED: "Tool Call Started", TOOL_CALL_COMPLETED: "Tool Call Completed",
    TOOL_CALL_FAILED: "Tool Call Failed",
    HTTP_CALL_STARTED: "HTTP Call Started", HTTP_CALL_COMPLETED: "HTTP Call Completed",
    HTTP_CALL_FAILED: "HTTP Call Failed",
    APPROVAL_REQUESTED: "Approval Requested", APPROVAL_APPROVED: "Approval Approved",
    APPROVAL_REJECTED: "Approval Rejected", APPROVAL_EXPIRED: "Approval Expired",
    RETRY_SCHEDULED: "Retry Scheduled", RETRY_STARTED: "Retry Started",
    RETRY_EXHAUSTED: "Retry Exhausted", ARTIFACT_CREATED: "Artifact Created",
  };

  return {
    glyph: glyphMap[type] ?? "○",
    dotColor,
    label: labelMap[type] ?? type,
  };
}

// Tag color per event category
function tagColor(type: TimelineEventType): string {
  if (type.startsWith("AGENT_"))    return "#A78BFA";
  if (type.startsWith("LLM_"))      return "#C084FC";
  if (type.startsWith("TOOL_"))     return "#22D3EE";
  if (type.startsWith("HTTP_"))     return "#6EE7B7";
  if (type.startsWith("APPROVAL_")) return "#FCD34D";
  if (type.startsWith("RETRY_"))    return "#FDA4AF";
  if (type.startsWith("ARTIFACT_")) return "#86EFAC";
  if (type.startsWith("RUN_"))      return "#93C5FD";
  return "#64748B";
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

type EventFilter = "ALL" | "AGENTS" | "LLM" | "TOOLS" | "HTTP" | "APPROVALS" | "RETRIES" | "ERRORS" | "ARTIFACTS";

const FILTERS: { key: EventFilter; label: string; types?: TimelineEventType[] }[] = [
  { key: "ALL",       label: "All" },
  { key: "AGENTS",    label: "Agents",    types: ["AGENT_STARTED", "AGENT_PLAN_CREATED", "AGENT_COMPLETED", "AGENT_FAILED", "AGENT_HANDOFF", "AGENT_SELECTED"] },
  { key: "LLM",       label: "LLM",       types: ["LLM_CALL_STARTED", "LLM_CALL_COMPLETED", "LLM_CALL_FAILED", "LLM_OUTPUT_VALIDATED"] },
  { key: "TOOLS",     label: "Tools",     types: ["TOOL_CALL_STARTED", "TOOL_CALL_COMPLETED", "TOOL_CALL_FAILED"] },
  { key: "HTTP",      label: "HTTP",      types: ["HTTP_CALL_STARTED", "HTTP_CALL_COMPLETED", "HTTP_CALL_FAILED"] },
  { key: "APPROVALS", label: "Approvals", types: ["APPROVAL_REQUESTED", "APPROVAL_APPROVED", "APPROVAL_REJECTED", "APPROVAL_EXPIRED"] },
  { key: "RETRIES",   label: "Retries",   types: ["RETRY_SCHEDULED", "RETRY_STARTED", "RETRY_EXHAUSTED"] },
  { key: "ERRORS",    label: "Errors" },
  { key: "ARTIFACTS", label: "Artifacts", types: ["ARTIFACT_CREATED"] },
];

// ─── Synthetic log generation ─────────────────────────────────────────────────

function generateLogs(event: RunTimelineEventUi): string[] {
  const ts = new Date(event.timestamp).toISOString();
  const lines: string[] = [];
  lines.push(`[${ts}] INFO  ${event.type} — seq #${event.sequence}`);
  if (event.agentName)  lines.push(`[${ts}] INFO  agent="${event.agentName}"`);
  if (event.toolName)   lines.push(`[${ts}] INFO  tool="${event.toolName}"`);
  if (event.modelName)  lines.push(`[${ts}] INFO  model="${event.modelName}"`);
  if (event.source)     lines.push(`[${ts}] DEBUG source="${event.source}"`);
  if (event.durationMs) lines.push(`[${ts}] DEBUG duration=${event.durationMs}ms`);
  if (event.tokensUsed) lines.push(`[${ts}] DEBUG tokens_used=${event.tokensUsed}`);
  if (event.errorMessage) {
    lines.push(`[${ts}] ERROR ${event.errorMessage}`);
  }
  if (event.summary) {
    lines.push(`[${ts}] INFO  summary="${event.summary}"`);
  }
  lines.push(`[${ts}] INFO  status=${event.status}`);
  return lines;
}

// ─── JSON block ───────────────────────────────────────────────────────────────

function JsonPanel({ value }: { value: unknown }) {
  return (
    <pre
      className="overflow-auto rounded-lg p-3 text-[10px] font-mono leading-relaxed"
      style={{ background: "#060A10", color: "#CBD5E1", border: "1px solid rgba(148,163,184,0.10)", maxHeight: 340 }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

// ─── KV row ───────────────────────────────────────────────────────────────────

function KVRow({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: string }) {
  return (
    <div className="flex gap-3 py-1.5" style={{ borderBottom: "1px solid rgba(148,163,184,0.05)" }}>
      <span className="w-36 shrink-0 text-[11px] font-medium" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      <span className={`text-[11px] ${mono ? "font-mono" : ""}`} style={{ color: accent ?? "var(--text-secondary)" }}>
        {value}
      </span>
    </div>
  );
}

// ─── Right-side details panel ─────────────────────────────────────────────────

type DetailTab = "summary" | "input" | "output" | "logs" | "metadata" | "error";

function DetailsPanel({ event, onClose }: { event: RunTimelineEventUi; onClose: () => void }) {
  const [tab, setTab] = useState<DetailTab>("summary");
  const color = tagColor(event.type);
  const meta = getEventMeta(event.type, event.status);
  const logs = useMemo(() => generateLogs(event), [event]);

  const tabs: { key: DetailTab; label: string; disabled?: boolean }[] = [
    { key: "summary",  label: "Summary" },
    { key: "input",    label: "Input",    disabled: event.inputJson == null },
    { key: "output",   label: "Output",   disabled: event.outputJson == null },
    { key: "logs",     label: "Logs" },
    { key: "metadata", label: "Metadata", disabled: event.metadataJson == null },
    { key: "error",    label: "Error",    disabled: !event.errorMessage },
  ];

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ background: "var(--surface-1)", height: "100%" }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 px-3 py-2.5"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-2)" }}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: meta.dotColor, boxShadow: `0 0 5px ${meta.dotColor}80` }}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-bold" style={{ color }}>
          {event.type}
        </span>
        <span className="shrink-0 text-[10px]" style={{ color: "var(--text-faint)" }}>
          #{event.sequence}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 transition-colors hover:bg-white/10"
          style={{ color: "var(--text-faint)" }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Tab bar */}
      <div
        className="flex shrink-0 items-center gap-0 overflow-x-auto"
        style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-2)" }}
      >
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            disabled={t.disabled}
            onClick={() => setTab(t.key)}
            className="shrink-0 px-3 py-2 text-[11px] font-medium transition-colors disabled:opacity-30"
            style={{
              color: tab === t.key ? "#2563EB" : "var(--text-faint)",
              borderBottom: tab === t.key ? "2px solid #38BDF8" : "2px solid transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="overflow-y-auto p-3" style={{ maxHeight: 500 }}>
        {tab === "summary" && (
          <div>
            <KVRow label="Status"    value={event.status} />
            <KVRow label="Source"    value={event.source} mono />
            <KVRow label="Timestamp" value={fmtTs(event.timestamp)} mono />
            {event.durationMs && <KVRow label="Duration" value={fmtDur(event.durationMs) ?? "—"} mono />}
            {event.agentName  && <KVRow label="Agent"    value={event.agentName}  mono accent="#A78BFA" />}
            {event.toolName   && <KVRow label="Tool"     value={event.toolName}   mono accent="#22D3EE" />}
            {event.modelName  && <KVRow label="Model"    value={event.modelName}  mono accent="#C084FC" />}
            {event.tokensUsed != null && <KVRow label="Tokens"  value={event.tokensUsed.toLocaleString()} mono />}
            {event.estimatedCostUsd != null && <KVRow label="Cost" value={`$${event.estimatedCostUsd.toFixed(6)}`} mono />}
            {event.handoffTo  && <KVRow label="Handoff →" value={event.handoffTo} mono accent="#A78BFA" />}
            {event.artifactName && <KVRow label="Artifact" value={event.artifactName} mono accent="#86EFAC" />}
            {event.actorName  && <KVRow label="Actor"   value={event.actorName} mono />}
            {event.summary    && <KVRow label="Summary" value={event.summary} />}
            {event.approval != null && (() => {
              const a = event.approval!;
              return (
                <>
                  <KVRow label="Approval ID"     value={a.id}     mono />
                  <KVRow label="Approval Status" value={a.status} />
                  {a.decidedBy      && <KVRow label="Decided By" value={a.decidedBy} mono />}
                  {a.decidedAt      && <KVRow label="Decided At" value={fmtTs(a.decidedAt)} mono />}
                  {a.decisionReason && <KVRow label="Decision"   value={a.decisionReason} />}
                </>
              );
            })()}
          </div>
        )}

        {tab === "input" && event.inputJson != null && (
          <JsonPanel value={event.inputJson} />
        )}

        {tab === "output" && event.outputJson != null && (
          <JsonPanel value={event.outputJson} />
        )}

        {tab === "logs" && (
          <pre
            className="overflow-auto rounded-lg p-3 text-[10px] font-mono leading-relaxed"
            style={{ background: "#060A10", color: "#94A3B8", border: "1px solid rgba(148,163,184,0.10)" }}
          >
            {logs.map((line, i) => {
              const isErr = line.includes(" ERROR ");
              const isWarn = line.includes(" WARN ");
              return (
                <span
                  key={i}
                  className="block"
                  style={{ color: isErr ? "#FCA5A5" : isWarn ? "#FCD34D" : undefined }}
                >
                  {line}
                </span>
              );
            })}
          </pre>
        )}

        {tab === "metadata" && event.metadataJson != null && (
          <JsonPanel value={event.metadataJson} />
        )}

        {tab === "error" && event.errorMessage && (
          <div>
            <pre
              className="overflow-auto rounded-lg p-3 text-[11px] font-mono leading-relaxed"
              style={{ background: "rgba(239,68,68,0.06)", color: "#FCA5A5", border: "1px solid rgba(239,68,68,0.20)" }}
            >
              {event.errorMessage}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Filter chips ─────────────────────────────────────────────────────────────

// ─── Main ─────────────────────────────────────────────────────────────────────

type ViewMode = "compact" | "full";

interface EventHistoryTabProps {
  events: RunTimelineEventUi[];
}

export function EventHistoryTab({ events }: EventHistoryTabProps) {
  const [activeFilter, setActiveFilter] = useState<EventFilter>("ALL");
  const [searchQuery, setSearchQuery]   = useState("");
  const [viewMode, setViewMode]         = useState<ViewMode>("compact");
  const [selectedEvent, setSelectedEvent] = useState<RunTimelineEventUi | null>(null);

  function selectEvent(e: RunTimelineEventUi) {
    setSelectedEvent(prev => prev?.id === e.id ? null : e);
  }

  const filtered = useMemo(() => {
    let result = events;
    const fCfg = FILTERS.find(f => f.key === activeFilter);
    if (activeFilter === "ERRORS") {
      result = events.filter(e => e.status === "FAILED");
    } else if (fCfg?.types) {
      result = events.filter(e => fCfg.types!.includes(e.type));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        (e.agentName?.toLowerCase().includes(q)) ||
        (e.toolName?.toLowerCase().includes(q)) ||
        (e.modelName?.toLowerCase().includes(q)) ||
        (e.summary?.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [events, activeFilter, searchQuery]);

  const errorCount = events.filter(e => e.status === "FAILED").length;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 rounded-lg px-3 py-2"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
      >
        <div className="flex flex-1 flex-wrap gap-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveFilter(f.key)}
              className="rounded px-2 py-1 text-[11px] font-medium transition-colors"
              style={
                activeFilter === f.key
                  ? { background: "#EFF6FF", color: "#2563EB" }
                  : { color: "var(--text-faint)" }
              }
            >
              {f.label}
              {f.key === "ERRORS" && errorCount > 0 && (
                <span
                  className="ml-1 rounded-full px-1 text-[9px]"
                  style={{ background: "rgba(239,68,68,0.15)", color: "#EF4444" }}
                >
                  {errorCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center rounded-md" style={{ border: "1px solid var(--border-subtle)" }}>
          <button
            type="button"
            title="Compact view"
            onClick={() => setViewMode("compact")}
            className="rounded-l-md p-1.5 transition-colors"
            style={viewMode === "compact" ? { background: "#EFF6FF", color: "#2563EB" } : { color: "var(--text-faint)" }}
          >
            <AlignJustify className="h-3 w-3" />
          </button>
          <button
            type="button"
            title="Full history view"
            onClick={() => setViewMode("full")}
            className="rounded-r-md p-1.5 transition-colors"
            style={viewMode === "full" ? { background: "#EFF6FF", color: "#2563EB" } : { color: "var(--text-faint)" }}
          >
            <AlignLeft className="h-3 w-3" />
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search…"
            className="h-7 rounded pl-6 pr-3 text-[11px] outline-none"
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
              width: 160,
            }}
          />
        </div>
      </div>

      {/* Main content: list + optional details panel */}
      <div className="flex gap-0 overflow-hidden rounded-xl" style={{ border: "1px solid var(--border-subtle)", minHeight: 400 }}>
        {/* Event list */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Column header */}
          <div
            className="flex shrink-0 items-center gap-0 px-0 py-2 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              borderBottom: "1px solid rgba(148,163,184,0.10)",
              background: "var(--surface-2)",
              color: "var(--text-faint)",
            }}
          >
            <span className="w-14 shrink-0 pl-4">#</span>
            <span className="flex-1">Event</span>
            {viewMode === "full" && <span className="w-24 shrink-0 pr-4 text-right">Duration</span>}
            <span className="w-52 shrink-0 pr-4 text-right">Timestamp</span>
          </div>

          {/* Rows */}
          <div className="overflow-y-auto" style={{ background: "var(--surface-1)", maxHeight: 560 }}>
            {filtered.length === 0 ? (
              <p className="py-12 text-center text-[13px]" style={{ color: "var(--text-faint)" }}>
                No events match.
              </p>
            ) : (
              filtered.map((event, idx) => {
                const meta      = getEventMeta(event.type, event.status);
                const isSelected = selectedEvent?.id === event.id;
                const isFailed  = event.status === "FAILED";
                const isWaiting = event.status === "WAITING" || event.status === "PENDING";
                const isLast    = idx === filtered.length - 1;
                const tag       = tagColor(event.type);
                const borderAccent = isFailed  ? "#EF4444"
                                   : isWaiting ? "#F59E0B"
                                   : isSelected ? "#2563EB"
                                   : "transparent";

                return (
                  <div
                    key={event.id}
                    className="flex cursor-pointer items-center gap-0 transition-colors"
                    style={{
                      borderLeft: `2px solid ${borderAccent}`,
                      borderBottom: !isLast ? "1px solid rgba(148,163,184,0.07)" : undefined,
                      background: isSelected
                        ? "#F5F9FF"
                        : isFailed
                          ? "rgba(239,68,68,0.025)"
                          : undefined,
                      minHeight: viewMode === "full" ? 48 : 36,
                    }}
                    onClick={() => selectEvent(event)}
                    onMouseEnter={e => {
                      if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "rgba(148,163,184,0.04)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.background = isSelected
                        ? "#F5F9FF"
                        : isFailed ? "rgba(239,68,68,0.025)" : "";
                    }}
                  >
                    {/* Sequence + dot */}
                    <div className="flex w-14 shrink-0 items-center gap-1.5 pl-3">
                      <span className="font-mono text-[11px] tabular-nums" style={{ color: "var(--text-faint)", minWidth: "1.5rem", textAlign: "right" }}>
                        {event.sequence}
                      </span>
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: meta.dotColor, boxShadow: `0 0 4px ${meta.dotColor}60` }}
                      />
                    </div>

                    {/* Event glyph + label + pills */}
                    <div className="flex flex-1 flex-col justify-center overflow-hidden py-2 pr-4">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="w-4 shrink-0 text-center text-[12px] leading-none select-none" style={{ color: tag }}>
                          {meta.glyph}
                        </span>
                        <span
                          className="text-[12px] font-medium"
                          style={{
                            color: isFailed  ? "#FCA5A5"
                                 : isWaiting ? "#FCD34D"
                                 : "var(--text-secondary)",
                          }}
                        >
                          {meta.label}
                        </span>
                        {event.agentName && (
                          <span className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "rgba(167,139,250,0.12)", color: "#A78BFA", maxWidth: 160 }}>
                            {event.agentName}
                          </span>
                        )}
                        {event.toolName && (
                          <span className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "rgba(34,211,238,0.10)", color: "#22D3EE", maxWidth: 160 }}>
                            {event.toolName}
                          </span>
                        )}
                        {event.modelName && (
                          <span className="truncate rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "rgba(192,132,252,0.10)", color: "#C084FC", maxWidth: 120 }}>
                            {event.modelName}
                          </span>
                        )}
                        {event.handoffTo && (
                          <span className="truncate font-mono text-[10px]" style={{ color: "#A78BFA" }}>
                            → {event.handoffTo}
                          </span>
                        )}
                      </div>
                      {viewMode === "full" && event.summary && (
                        <p className="mt-0.5 truncate pl-6 text-[11px]" style={{ color: "var(--text-faint)" }}>
                          {event.summary}
                        </p>
                      )}
                    </div>

                    {/* Duration */}
                    {viewMode === "full" && (
                      <span className="w-24 shrink-0 pr-4 text-right font-mono text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>
                        {fmtDur(event.durationMs) ?? "—"}
                      </span>
                    )}

                    {/* Timestamp */}
                    <span className="w-52 shrink-0 pr-4 text-right font-mono text-[11px] tabular-nums" style={{ color: "var(--text-faint)" }}>
                      {fmtTs(event.timestamp)}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 px-4 py-2" style={{ borderTop: "1px solid rgba(148,163,184,0.07)", background: "var(--surface-2)" }}>
            <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
              {filtered.length} event{filtered.length !== 1 ? "s" : ""}
              {filtered.length !== events.length && ` of ${events.length}`}
            </p>
          </div>
        </div>

        {/* Right-side details panel */}
        {selectedEvent && (
          <div className="w-80 shrink-0 overflow-hidden" style={{ borderLeft: "1px solid var(--border-subtle)", maxHeight: 600 }}>
            <DetailsPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
