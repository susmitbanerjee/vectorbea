"use client";

import React, { useState, useMemo } from "react";
import { Search } from "lucide-react";
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
  // Dot color driven by STATUS first, then type
  const dotByStatus: Record<string, string> = {
    SUCCEEDED: "#10B981",
    FAILED:    "#EF4444",
    RUNNING:   "#38BDF8",
    WAITING:   "#F59E0B",
    PENDING:   "#64748B",
    CANCELLED: "#475569",
    SKIPPED:   "#334155",
  };

  const dotColor = dotByStatus[status] ?? "#475569";

  const glyphMap: Partial<Record<TimelineEventType, string>> = {
    RUN_CREATED:            "⊕",
    RUN_QUEUED:             "○",
    RUN_STARTED:            "▶",
    RUN_PAUSED:             "⏸",
    RUN_RESUMED:            "▶",
    RUN_SUCCEEDED:          "✓",
    RUN_FAILED:             "✕",
    RUN_CANCELLED:          "⊘",
    RUN_TIMED_OUT:          "⏱",
    BUDGET_CHECK_PASSED:    "$",
    BUDGET_CHECK_FAILED:    "$",
    POLICY_CHECK_PASSED:    "✓",
    POLICY_CHECK_FAILED:    "✕",
    AGENT_SELECTED:         "◈",
    AGENT_STARTED:          "◈",
    AGENT_PLAN_CREATED:     "◈",
    AGENT_HANDOFF:          "⇢",
    AGENT_COMPLETED:        "◈",
    AGENT_FAILED:           "◈",
    STEP_STARTED:           "◇",
    STEP_COMPLETED:         "◇",
    STEP_FAILED:            "◇",
    LLM_CALL_STARTED:       "⚡",
    LLM_CALL_COMPLETED:     "⚡",
    LLM_CALL_FAILED:        "⚡",
    LLM_OUTPUT_VALIDATED:   "⚡",
    TOOL_CALL_STARTED:      "⬡",
    TOOL_CALL_COMPLETED:    "⬡",
    TOOL_CALL_FAILED:       "⬡",
    HTTP_CALL_STARTED:      "⇄",
    HTTP_CALL_COMPLETED:    "⇄",
    HTTP_CALL_FAILED:       "⇄",
    APPROVAL_REQUESTED:     "◉",
    APPROVAL_APPROVED:      "◉",
    APPROVAL_REJECTED:      "◉",
    APPROVAL_EXPIRED:       "◉",
    RETRY_SCHEDULED:        "↺",
    RETRY_STARTED:          "↺",
    RETRY_EXHAUSTED:        "↺",
    ARTIFACT_CREATED:       "⬟",
  };

  // Human-readable short label
  const labelMap: Partial<Record<TimelineEventType, string>> = {
    RUN_CREATED:            "Run Created",
    RUN_QUEUED:             "Run Queued",
    RUN_STARTED:            "Run Started",
    RUN_PAUSED:             "Run Paused",
    RUN_RESUMED:            "Run Resumed",
    RUN_SUCCEEDED:          "Run Succeeded",
    RUN_FAILED:             "Run Failed",
    RUN_CANCELLED:          "Run Cancelled",
    RUN_TIMED_OUT:          "Run Timed Out",
    BUDGET_CHECK_PASSED:    "Budget Check Passed",
    BUDGET_CHECK_FAILED:    "Budget Check Failed",
    POLICY_CHECK_PASSED:    "Policy Check Passed",
    POLICY_CHECK_FAILED:    "Policy Check Failed",
    AGENT_SELECTED:         "Agent Selected",
    AGENT_STARTED:          "Agent Started",
    AGENT_PLAN_CREATED:     "Agent Plan Created",
    AGENT_HANDOFF:          "Agent Handoff",
    AGENT_COMPLETED:        "Agent Completed",
    AGENT_FAILED:           "Agent Failed",
    STEP_STARTED:           "Step Started",
    STEP_COMPLETED:         "Step Completed",
    STEP_FAILED:            "Step Failed",
    LLM_CALL_STARTED:       "LLM Call Started",
    LLM_CALL_COMPLETED:     "LLM Call Completed",
    LLM_CALL_FAILED:        "LLM Call Failed",
    LLM_OUTPUT_VALIDATED:   "LLM Output Validated",
    TOOL_CALL_STARTED:      "Tool Call Started",
    TOOL_CALL_COMPLETED:    "Tool Call Completed",
    TOOL_CALL_FAILED:       "Tool Call Failed",
    HTTP_CALL_STARTED:      "HTTP Call Started",
    HTTP_CALL_COMPLETED:    "HTTP Call Completed",
    HTTP_CALL_FAILED:       "HTTP Call Failed",
    APPROVAL_REQUESTED:     "Approval Requested",
    APPROVAL_APPROVED:      "Approval Approved",
    APPROVAL_REJECTED:      "Approval Rejected",
    APPROVAL_EXPIRED:       "Approval Expired",
    RETRY_SCHEDULED:        "Retry Scheduled",
    RETRY_STARTED:          "Retry Started",
    RETRY_EXHAUSTED:        "Retry Exhausted",
    ARTIFACT_CREATED:       "Artifact Created",
  };

  return {
    glyph: glyphMap[type] ?? "○",
    dotColor,
    label: labelMap[type] ?? type,
  };
}

// Tag color per event category
function tagColor(type: TimelineEventType): string {
  if (type.startsWith("AGENT_"))    return "#A78BFA"; // violet
  if (type.startsWith("LLM_"))      return "#C084FC"; // purple
  if (type.startsWith("TOOL_"))     return "#22D3EE"; // cyan
  if (type.startsWith("HTTP_"))     return "#6EE7B7"; // teal
  if (type.startsWith("APPROVAL_")) return "#FCD34D"; // amber
  if (type.startsWith("RETRY_"))    return "#FDA4AF"; // rose
  if (type.startsWith("ARTIFACT_")) return "#86EFAC"; // green
  if (type.startsWith("RUN_"))      return "#93C5FD"; // blue
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

// ─── KV detail row ────────────────────────────────────────────────────────────

function KVRow({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: string }) {
  return (
    <div className="flex gap-3 py-1.5" style={{ borderBottom: "1px solid rgba(148,163,184,0.05)" }}>
      <span
        className="w-40 shrink-0 text-[11px] font-medium"
        style={{ color: "var(--text-faint)" }}
      >
        {label}
      </span>
      <span
        className={`text-[11px] ${mono ? "font-mono" : ""}`}
        style={{ color: accent ?? "var(--text-secondary)" }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Inline detail block ──────────────────────────────────────────────────────

function EventDetail({ event }: { event: RunTimelineEventUi }) {
  const meta = getEventMeta(event.type, event.status);

  return (
    <div
      className="px-4 py-3"
      style={{ background: "rgba(56,189,248,0.03)", borderBottom: "1px solid rgba(148,163,184,0.08)" }}
    >
      {/* Detail header */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
          style={{ background: "rgba(148,163,184,0.08)", color: tagColor(event.type) }}
        >
          {event.type}
        </span>
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          Event #{event.sequence}
        </span>
      </div>

      {/* KV rows */}
      <div className="space-y-0">
        <KVRow label="Status"    value={event.status} />
        <KVRow label="Source"    value={event.source} mono />
        <KVRow label="Timestamp" value={fmtTs(event.timestamp)} mono />

        {event.durationMs !== undefined && (
          <KVRow label="Duration" value={fmtDur(event.durationMs) ?? "—"} mono />
        )}
        {event.agentName && (
          <KVRow label="Agent" value={event.agentName} mono accent="#A78BFA" />
        )}
        {event.toolName && (
          <KVRow label="Tool" value={event.toolName} mono accent="#22D3EE" />
        )}
        {event.modelName && (
          <KVRow label="Model" value={event.modelName} mono accent="#C084FC" />
        )}
        {event.tokensUsed !== undefined && (
          <KVRow label="Tokens Used" value={event.tokensUsed.toLocaleString()} mono />
        )}
        {event.estimatedCostUsd !== undefined && (
          <KVRow label="Estimated Cost" value={`$${event.estimatedCostUsd.toFixed(6)}`} mono />
        )}
        {event.handoffTo && (
          <KVRow label="Handoff To" value={event.handoffTo} mono accent="#A78BFA" />
        )}
        {event.artifactName && (
          <KVRow label="Artifact" value={event.artifactName} mono accent="#86EFAC" />
        )}
        {event.actorName && (
          <KVRow label="Actor" value={event.actorName} mono />
        )}
        {event.summary && (
          <KVRow label="Summary" value={event.summary} />
        )}
        {event.errorMessage && (
          <KVRow label="Error" value={event.errorMessage} mono accent="#FCA5A5" />
        )}

        {/* Approval details */}
        {event.approval != null && (() => {
          const a = event.approval!;
          return (
            <>
              <KVRow label="Approval ID"     value={a.id} mono />
              <KVRow label="Approval Title"  value={a.title} />
              <KVRow label="Approval Status" value={a.status} />
              {a.decidedBy        && <KVRow label="Decided By"      value={a.decidedBy} mono />}
              {a.decidedAt        && <KVRow label="Decided At"      value={fmtTs(a.decidedAt)} mono />}
              {a.decisionReason   && <KVRow label="Decision Reason" value={a.decisionReason} />}
            </>
          );
        })()}

        {/* Metadata fields (flattened) */}
        {event.metadataJson != null && typeof event.metadataJson === "object" &&
          (Object.entries(event.metadataJson as Record<string, unknown>).map(([k, v]) => (
            <KVRow
              key={k}
              label={k}
              value={typeof v === "object" ? JSON.stringify(v) : String(v)}
              mono
            />
          )) as React.ReactNode)
        }

        {/* Input / Output flattened KV */}
        {event.inputJson != null && typeof event.inputJson === "object" && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
              Input
            </p>
            {(Object.entries(event.inputJson as Record<string, unknown>).map(([k, v]) => (
              <KVRow
                key={k}
                label={k}
                value={typeof v === "object" ? JSON.stringify(v) : String(v)}
                mono
              />
            )) as React.ReactNode)}
          </div>
        )}

        {event.outputJson != null && typeof event.outputJson === "object" && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
              Output
            </p>
            {(Object.entries(event.outputJson as Record<string, unknown>).map(([k, v]) => (
              <KVRow
                key={k}
                label={k}
                value={typeof v === "object" ? JSON.stringify(v) : String(v)}
                mono
              />
            )) as React.ReactNode)}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface EventHistoryTabProps {
  events: RunTimelineEventUi[];
}

export function EventHistoryTab({ events }: EventHistoryTabProps) {
  const [activeFilter, setActiveFilter] = useState<EventFilter>("ALL");
  const [searchQuery, setSearchQuery]   = useState("");
  // Allow multiple rows expanded simultaneously (like Temporal)
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
    <div className="space-y-3">
      {/* Toolbar: filter chips + search */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2"
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
                  ? { background: "rgba(56,189,248,0.12)", color: "#38BDF8" }
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

      {/* Event list */}
      <div
        className="overflow-hidden rounded-xl"
        style={{ background: "var(--surface-1)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Column header */}
        <div
          className="flex items-center gap-0 px-0 py-2 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            borderBottom: "1px solid rgba(148,163,184,0.10)",
            background: "var(--surface-2)",
            color: "var(--text-faint)",
          }}
        >
          <span className="w-14 shrink-0 pl-4">#</span>
          <span className="flex-1">Event</span>
          <span className="w-52 shrink-0 pr-4 text-right">Timestamp</span>
        </div>

        {filtered.length === 0 ? (
          <p className="py-12 text-center text-[13px]" style={{ color: "var(--text-faint)" }}>
            No events match.
          </p>
        ) : (
          filtered.map((event, idx) => {
            const meta      = getEventMeta(event.type, event.status);
            const isOpen    = expanded.has(event.id);
            const isFailed  = event.status === "FAILED";
            const isWaiting = event.status === "WAITING" || event.status === "PENDING";
            const isLast    = idx === filtered.length - 1;
            const tag       = tagColor(event.type);

            // Accent color for row left border
            const borderAccent = isFailed  ? "#EF4444"
                               : isWaiting ? "#F59E0B"
                               : isOpen    ? "#38BDF8"
                               : "transparent";

            return (
              <div key={event.id}>
                {/* ── Row ── */}
                <div
                  className="flex cursor-pointer items-center gap-0 transition-colors"
                  style={{
                    borderLeft: `2px solid ${borderAccent}`,
                    borderBottom: isOpen || !isLast ? "1px solid rgba(148,163,184,0.07)" : undefined,
                    background: isOpen
                      ? "rgba(56,189,248,0.04)"
                      : isFailed
                        ? "rgba(239,68,68,0.025)"
                        : undefined,
                  }}
                  onClick={() => toggleExpanded(event.id)}
                  // hover via onMouseOver/Out to avoid Tailwind hover fighting inline bg
                  onMouseEnter={e => {
                    if (!isOpen) (e.currentTarget as HTMLDivElement).style.background = "rgba(148,163,184,0.04)";
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLDivElement).style.background = isOpen
                      ? "rgba(56,189,248,0.04)"
                      : isFailed
                        ? "rgba(239,68,68,0.025)"
                        : "";
                  }}
                >
                  {/* Sequence + dot rail */}
                  <div className="flex w-14 shrink-0 items-center gap-1.5 pl-3">
                    <span
                      className="font-mono text-[11px] tabular-nums"
                      style={{ color: "var(--text-faint)", minWidth: "1.5rem", textAlign: "right" }}
                    >
                      {event.sequence}
                    </span>
                    {/* The colored dot */}
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: meta.dotColor, boxShadow: `0 0 4px ${meta.dotColor}60` }}
                    />
                  </div>

                  {/* Event glyph + label + optional tag */}
                  <div className="flex flex-1 items-center gap-2 overflow-hidden py-2.5 pr-4">
                    {/* Glyph */}
                    <span
                      className="w-4 shrink-0 text-center text-[12px] leading-none select-none"
                      style={{ color: tag }}
                    >
                      {meta.glyph}
                    </span>

                    {/* Event label */}
                    <span
                      className="text-[13px] font-medium"
                      style={{
                        color: isFailed  ? "#FCA5A5"
                             : isWaiting ? "#FCD34D"
                             : "var(--text-secondary)",
                      }}
                    >
                      {meta.label}
                    </span>

                    {/* Agent / tool / model tag — colored pill */}
                    {event.agentName && (
                      <span
                        className="ml-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ background: "rgba(167,139,250,0.12)", color: "#A78BFA", maxWidth: 200 }}
                      >
                        {event.agentName}
                      </span>
                    )}
                    {event.toolName && (
                      <span
                        className="truncate rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ background: "rgba(34,211,238,0.10)", color: "#22D3EE", maxWidth: 200 }}
                      >
                        {event.toolName}
                      </span>
                    )}
                    {event.modelName && (
                      <span
                        className="truncate rounded px-1.5 py-0.5 text-[11px] font-medium"
                        style={{ background: "rgba(192,132,252,0.10)", color: "#C084FC", maxWidth: 160 }}
                      >
                        {event.modelName}
                      </span>
                    )}
                    {event.handoffTo && (
                      <span
                        className="truncate font-mono text-[10px]"
                        style={{ color: "#A78BFA" }}
                      >
                        → {event.handoffTo}
                      </span>
                    )}
                  </div>

                  {/* Timestamp */}
                  <span
                    className="w-52 shrink-0 pr-4 text-right font-mono text-[11px] tabular-nums"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {fmtTs(event.timestamp)}
                  </span>
                </div>

                {/* ── Inline detail block ── */}
                {isOpen && <EventDetail event={event} />}
              </div>
            );
          })
        )}
      </div>

      {/* Footer count */}
      <p className="px-1 text-[11px]" style={{ color: "var(--text-faint)" }}>
        {filtered.length} event{filtered.length !== 1 ? "s" : ""}
        {filtered.length !== events.length && ` of ${events.length}`}
      </p>
    </div>
  );
}
