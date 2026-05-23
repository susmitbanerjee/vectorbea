"use client";

import { useState, useMemo } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunTimelineEventUi, TimelineEventType } from "@/types/agent-run-ui";
import { getEventConfig } from "../EventTypeBadge";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTs(ts: string) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function fmtDur(ms?: number) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

const STATUS_DOT: Record<string, string> = {
  SUCCEEDED: "#10B981",
  FAILED:    "#EF4444",
  RUNNING:   "#38BDF8",
  WAITING:   "#F59E0B",
  PENDING:   "#64748B",
  CANCELLED: "#64748B",
  SKIPPED:   "#475569",
};

// ─── Filter definition ────────────────────────────────────────────────────────

type EventFilter = "ALL" | "AGENTS" | "LLM" | "TOOLS" | "HTTP" | "APPROVALS" | "RETRIES" | "ERRORS" | "ARTIFACTS";

const FILTERS: { key: EventFilter; label: string; types?: TimelineEventType[] }[] = [
  { key: "ALL",       label: "All" },
  { key: "AGENTS",    label: "Agents",    types: ["AGENT_STARTED", "AGENT_PLAN_CREATED", "AGENT_COMPLETED", "AGENT_FAILED", "AGENT_HANDOFF"] },
  { key: "LLM",       label: "LLM",       types: ["LLM_CALL_STARTED", "LLM_CALL_COMPLETED", "LLM_CALL_FAILED", "LLM_OUTPUT_VALIDATED"] },
  { key: "TOOLS",     label: "Tools",     types: ["TOOL_CALL_STARTED", "TOOL_CALL_COMPLETED", "TOOL_CALL_FAILED"] },
  { key: "HTTP",      label: "HTTP",      types: ["HTTP_CALL_STARTED", "HTTP_CALL_COMPLETED", "HTTP_CALL_FAILED"] },
  { key: "APPROVALS", label: "Approvals", types: ["APPROVAL_REQUESTED", "APPROVAL_APPROVED", "APPROVAL_REJECTED", "APPROVAL_EXPIRED"] },
  { key: "RETRIES",   label: "Retries",   types: ["RETRY_SCHEDULED", "RETRY_STARTED", "RETRY_EXHAUSTED"] },
  { key: "ERRORS",    label: "Errors" },  // filtered by status
  { key: "ARTIFACTS", label: "Artifacts", types: ["ARTIFACT_CREATED"] },
];

// ─── JSON panel ──────────────────────────────────────────────────────────────

function JsonPanel({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(value, null, 2);
  async function copy() {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{label}</span>
        <button type="button" onClick={() => void copy()} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-white/5" style={{ color: "var(--text-faint)" }}>
          {copied ? <><Check className="h-3 w-3 text-emerald-500" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}
        </button>
      </div>
      <pre
        className="max-h-40 overflow-auto rounded-lg px-3 py-2.5 text-[11px] leading-relaxed font-mono"
        style={{ background: "#060A10", color: "#CBD5E1", border: "1px solid rgba(148,163,184,0.1)" }}
      >
        {json}
      </pre>
    </div>
  );
}

// ─── Event detail drawer ──────────────────────────────────────────────────────

function EventDetailPanel({ event, onClose }: { event: RunTimelineEventUi; onClose: () => void }) {
  const cfg = getEventConfig(event.type);
  const dotColor = STATUS_DOT[event.status] ?? "#64748B";

  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: "1px solid rgba(148,163,184,0.08)" }}
      >
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full" style={{ background: dotColor }} />
          <span className="font-mono text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
            #{event.sequence}
          </span>
          <span
            className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium"
            style={{ background: cfg.bg.replace("bg-", ""), borderColor: "rgba(148,163,184,0.15)", color: "var(--text-muted)" }}
          >
            {event.type}
          </span>
          <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {event.title}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 transition-colors hover:bg-white/5"
          style={{ color: "var(--text-faint)" }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        {/* Left: core metadata */}
        <div className="space-y-3">
          <MetaRow label="Source" value={event.source} mono />
          <MetaRow label="Status" value={event.status} />
          <MetaRow label="Timestamp" value={new Date(event.timestamp).toLocaleString()} mono />
          {event.durationMs !== undefined && <MetaRow label="Duration" value={fmtDur(event.durationMs) ?? "—"} mono />}
          {event.agentName && <MetaRow label="Agent" value={event.agentName} mono />}
          {event.toolName && <MetaRow label="Tool" value={event.toolName} mono />}
          {event.modelName && <MetaRow label="Model" value={event.modelName} mono />}
          {event.tokensUsed !== undefined && <MetaRow label="Tokens" value={event.tokensUsed.toLocaleString()} mono />}
          {event.estimatedCostUsd !== undefined && <MetaRow label="Cost" value={`$${event.estimatedCostUsd.toFixed(6)}`} mono />}
          {event.artifactName && <MetaRow label="Artifact" value={event.artifactName} mono />}
          {event.handoffTo && <MetaRow label="Handoff To" value={event.handoffTo} mono />}
          {event.summary && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Summary</p>
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>{event.summary}</p>
            </div>
          )}
          {event.errorMessage && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#EF4444" }}>Error</p>
              <p className="rounded-lg px-3 py-2 text-[12px] font-mono" style={{ background: "rgba(239,68,68,0.06)", color: "#FCA5A5" }}>
                {event.errorMessage}
              </p>
            </div>
          )}
        </div>

        {/* Right: JSON panels */}
        <div className="space-y-3">
          {event.inputJson !== undefined && <JsonPanel label="Input" value={event.inputJson} />}
          {event.outputJson !== undefined && <JsonPanel label="Output" value={event.outputJson} />}
          {event.approval && <JsonPanel label="Approval payload" value={event.approval} />}
          {event.metadataJson !== undefined && <JsonPanel label="Metadata" value={event.metadataJson} />}
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-20 shrink-0 text-[11px] font-semibold" style={{ color: "var(--text-faint)" }}>{label}</span>
      <span className={cn("text-[12px]", mono && "font-mono")} style={{ color: "var(--text-secondary)" }}>{value}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface EventHistoryTabProps {
  events: RunTimelineEventUi[];
}

export function EventHistoryTab({ events }: EventHistoryTabProps) {
  const [activeFilter, setActiveFilter] = useState<EventFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<RunTimelineEventUi | null>(null);

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
      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg px-3 py-2.5"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5 flex-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveFilter(f.key)}
              className={cn(
                "rounded px-2 py-1 text-[11px] font-medium transition-colors",
                activeFilter === f.key
                  ? "text-foreground"
                  : "hover:bg-white/5",
              )}
              style={activeFilter === f.key
                ? { background: "rgba(56,189,248,0.12)", color: "#38BDF8" }
                : { color: "var(--text-faint)" }
              }
            >
              {f.label}
              {f.key === "ERRORS" && errorCount > 0 && (
                <span className="ml-1 rounded-full px-1 text-[9px]" style={{ background: "rgba(239,68,68,0.15)", color: "#EF4444" }}>
                  {errorCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2" style={{ color: "var(--text-faint)" }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search events…"
            className="h-7 rounded-md pl-6 pr-3 text-[12px] outline-none transition-colors"
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      </div>

      {/* Count */}
      <p className="px-1 text-[11px]" style={{ color: "var(--text-faint)" }}>
        {filtered.length} event{filtered.length !== 1 ? "s" : ""}
        {filtered.length !== events.length && <span style={{ color: "var(--text-faint)" }}> of {events.length}</span>}
      </p>

      {/* Table */}
      <div
        className="overflow-hidden rounded-xl"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
      >
        {/* Table head */}
        <div
          className="grid items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            gridTemplateColumns: "2.5rem 12rem 1fr 6rem 5rem 5rem",
            borderBottom: "1px solid rgba(148,163,184,0.08)",
            color: "var(--text-faint)",
            background: "var(--surface-3)",
          }}
        >
          <span>#</span>
          <span>Event Type</span>
          <span>Details</span>
          <span>Source</span>
          <span>Time</span>
          <span>Duration</span>
        </div>

        {/* Rows */}
        <div>
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-[13px]" style={{ color: "var(--text-faint)" }}>
              No events match the current filter.
            </p>
          ) : (
            filtered.map((event, idx) => {
              const dotColor = STATUS_DOT[event.status] ?? "#64748B";
              const isSelected = selectedEvent?.id === event.id;
              const isFailed = event.status === "FAILED";
              const isWaiting = event.status === "WAITING";

              return (
                <div key={event.id} className="group">
                  {/* Row */}
                  <div
                    className="grid cursor-pointer items-start px-4 py-2.5 transition-colors"
                    style={{
                      gridTemplateColumns: "2.5rem 12rem 1fr 6rem 5rem 5rem",
                      borderBottom: idx < filtered.length - 1 ? "1px solid rgba(148,163,184,0.05)" : undefined,
                      background: isSelected
                        ? "rgba(56,189,248,0.05)"
                        : isFailed
                          ? "rgba(239,68,68,0.02)"
                          : undefined,
                      borderLeft: isSelected ? "2px solid #38BDF8" : isFailed ? "2px solid #EF4444" : isWaiting ? "2px solid #F59E0B" : "2px solid transparent",
                    }}
                    onClick={() => setSelectedEvent(isSelected ? null : event)}
                    onMouseOver={e => {
                      if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "rgba(148,163,184,0.03)";
                    }}
                    onMouseOut={e => {
                      if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = isFailed ? "rgba(239,68,68,0.02)" : "";
                    }}
                  >
                    {/* Seq */}
                    <span className="font-mono text-[10px] tabular-nums" style={{ color: "var(--text-faint)" }}>
                      {event.sequence}
                    </span>

                    {/* Event type */}
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dotColor }} />
                      <span className="truncate font-mono text-[10px] font-semibold" style={{ color: "var(--text-muted)" }}>
                        {event.type}
                      </span>
                    </div>

                    {/* Details */}
                    <div className="min-w-0 pr-4">
                      <p className="truncate text-[12px] font-medium" style={{ color: isFailed ? "#FCA5A5" : isWaiting ? "#FCD34D" : "var(--text-primary)" }}>
                        {event.title}
                      </p>
                      {(event.agentName || event.toolName || event.modelName) && (
                        <p className="mt-0.5 truncate font-mono text-[10px]" style={{ color: "var(--text-faint)" }}>
                          {event.agentName && <span className="text-violet-400">[{event.agentName}]</span>}
                          {event.toolName && <span className="text-cyan-400"> {event.toolName}</span>}
                          {event.modelName && <span className="text-purple-400"> {event.modelName}</span>}
                        </p>
                      )}
                    </div>

                    {/* Source */}
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-faint)" }}>
                      {event.source}
                    </span>

                    {/* Timestamp */}
                    <span className="font-mono text-[10px] tabular-nums" style={{ color: "var(--text-faint)" }}>
                      {fmtTs(event.timestamp)}
                    </span>

                    {/* Duration */}
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-faint)" }}>
                      {fmtDur(event.durationMs) ?? "—"}
                    </span>
                  </div>

                  {/* Expanded detail panel */}
                  {isSelected && (
                    <div className="px-4 pb-4 pt-1">
                      <EventDetailPanel event={event} onClose={() => setSelectedEvent(null)} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
