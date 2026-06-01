"use client";

/**
 * RunTimeline — clean vertical timeline for Business View and Engineering View.
 *
 * Visual design:
 *  • White card, rounded-2xl, border #E2E8F0
 *  • Vertical connector line #E2E8F0 between items
 *  • 36px circular icon badge per event
 *  • Event title, subtitle, right-aligned timestamp
 *  • Status colours: blue=info, green=success, amber=warn, red=error, gray=neutral
 *  • CSS fade+slide animation (no heavy deps — uses inline CSS transitions)
 *
 * Props:
 *  • events: RunTimelineEventUi[]  — raw events from API
 *  • variant: "business" | "engineering"
 *  • selectedId?: string           — highlights the selected event
 *  • onSelect?: (id) => void       — called when an item is clicked
 *  • isLive?: boolean              — pulsing indicator on the last "running" item
 */

import { useMemo } from "react";
import type { RunTimelineEventUi } from "@/types/agent-run-ui";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Database,
  Globe2,
  Loader2,
  Mail,
  PlayCircle,
  RefreshCw,
  Shield,
  ShieldCheck,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Status colours ───────────────────────────────────────────────────────────

type StatusTone = "blue" | "green" | "amber" | "red" | "gray";

const TONE: Record<StatusTone, { icon: string; badge: string; border: string; line: string }> = {
  blue:  { icon: "#2563EB", badge: "#EFF6FF", border: "#BFDBFE", line: "#2563EB" },
  green: { icon: "#059669", badge: "#ECFDF5", border: "#A7F3D0", line: "#059669" },
  amber: { icon: "#D97706", badge: "#FFFBEB", border: "#FDE68A", line: "#D97706" },
  red:   { icon: "#DC2626", badge: "#FEF2F2", border: "#FECACA", line: "#DC2626" },
  gray:  { icon: "#64748B", badge: "#F8FAFC", border: "#E2E8F0", line: "#CBD5E1" },
};

// ─── Timeline item model ──────────────────────────────────────────────────────

interface TimelineItem {
  id:        string;
  title:     string;
  subtitle?: string;
  timestamp: string;
  tone:      StatusTone;
  icon:      LucideIcon;
  isRunning: boolean;
  rawEventId: string;
  metadata?: Record<string, unknown>;
}

// ─── Event → tone mapping ─────────────────────────────────────────────────────

function eventTone(ev: RunTimelineEventUi): StatusTone {
  const t = ev.type;
  if (t.includes("FAILED") || t.includes("REJECTED") || t.includes("ERROR"))           return "red";
  if (t.includes("SUCCEEDED") || t.includes("COMPLETED") || t.includes("APPROVED") ||
      t.includes("VALIDATED") || t === "RUN_SUCCEEDED" || t === "APPROVAL_APPROVED")   return "green";
  if (t.includes("RETRY") || t.includes("RATE_LIMIT") || t.includes("WARNING") ||
      t.includes("REQUESTED") || t === "APPROVAL_REQUESTED")                            return "amber";
  if (ev.status === "FAILED")  return "red";
  if (ev.status === "RUNNING") return "blue";
  return "blue";
}

function eventIcon(ev: RunTimelineEventUi): LucideIcon {
  const t = ev.type;
  if (t === "RUN_CREATED" || t === "RUN_STARTED" || t === "RUN_QUEUED") return PlayCircle;
  if (t === "RUN_SUCCEEDED")  return CheckCircle2;
  if (t === "RUN_FAILED")     return XCircle;
  if (t === "RUN_CANCELLED")  return XCircle;
  if (t.startsWith("AGENT"))  return BrainCircuit;
  if (t.startsWith("LLM"))    return BrainCircuit;
  if (t.startsWith("HTTP"))   return Globe2;
  if (t.includes("DATABASE") || t.includes("DB")) return Database;
  if (t.includes("EMAIL"))    return Mail;
  if (t.includes("RETRY") || t.includes("RECOVER")) return RefreshCw;
  if (t.includes("APPROVAL_REQUESTED")) return Shield;
  if (t.includes("APPROVED")) return ShieldCheck;
  if (t.includes("REJECTED")) return XCircle;
  if (t.includes("TOOL"))     return Zap;
  if (t.includes("TIMER") || t.includes("WAITING")) return Clock;
  if (t === "STEP_STARTED")   return PlayCircle;
  if (t === "STEP_COMPLETED") return CheckCircle2;
  if (t === "STEP_FAILED")    return AlertTriangle;
  return PlayCircle;
}

function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return ts; }
}

function fmtDuration(ms: number | undefined): string {
  if (!ms) return "";
  if (ms < 1000) return ` · ${ms}ms`;
  if (ms < 60_000) return ` · ${(ms / 1000).toFixed(1)}s`;
  return ` · ${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// ─── Business timeline mapper ─────────────────────────────────────────────────
// Groups low-level events into human-friendly summaries.

function buildBusinessItems(events: RunTimelineEventUi[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const seen = new Set<string>(); // de-dupe grouped event categories

  for (const ev of events) {
    const t = ev.type;

    // Run lifecycle
    if (t === "RUN_CREATED" || t === "RUN_STARTED" || t === "RUN_QUEUED") {
      if (!seen.has("run_start")) {
        seen.add("run_start");
        items.push({
          id: ev.id, rawEventId: ev.id, tone: "blue", icon: PlayCircle, isRunning: false,
          title: "Run started",
          subtitle: ev.summary ?? (ev.source ? `Triggered by ${ev.source.toLowerCase()}` : undefined),
          timestamp: ev.timestamp,
        });
      }
      continue;
    }

    if (t === "RUN_SUCCEEDED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "green", icon: CheckCircle2, isRunning: false,
        title: "Run completed",
        subtitle: `${ev.summary ?? "All steps succeeded"}${fmtDuration(ev.durationMs)}`,
        timestamp: ev.timestamp,
      });
      continue;
    }

    if (t === "RUN_FAILED" || t === "RUN_CANCELLED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "red", icon: XCircle, isRunning: false,
        title: t === "RUN_CANCELLED" ? "Run cancelled" : "Run failed",
        subtitle: ev.errorMessage ?? ev.summary,
        timestamp: ev.timestamp,
      });
      continue;
    }

    // Agent steps — show one item per unique agent invocation
    if (t === "AGENT_STARTED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "blue", icon: BrainCircuit, isRunning: true,
        title: `${ev.agentName ?? "Agent"} started`,
        subtitle: ev.summary,
        timestamp: ev.timestamp,
      });
      continue;
    }

    if (t === "AGENT_COMPLETED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "green", icon: BrainCircuit, isRunning: false,
        title: `${ev.agentName ?? "Agent"} completed`,
        subtitle: ev.summary ?? `${ev.tokensUsed ? `${ev.tokensUsed.toLocaleString()} tokens` : ""}${fmtDuration(ev.durationMs)}`,
        timestamp: ev.timestamp,
      });
      continue;
    }

    if (t === "AGENT_FAILED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "red", icon: XCircle, isRunning: false,
        title: `${ev.agentName ?? "Agent"} failed`,
        subtitle: ev.errorMessage ?? ev.summary,
        timestamp: ev.timestamp,
      });
      continue;
    }

    // Approvals
    if (t === "APPROVAL_REQUESTED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "amber", icon: Shield, isRunning: false,
        title: "Approval requested",
        subtitle: ev.summary ?? ev.approval?.message,
        timestamp: ev.timestamp,
      });
      continue;
    }
    if (t === "APPROVAL_APPROVED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "green", icon: ShieldCheck, isRunning: false,
        title: "Approval approved",
        subtitle: ev.approval?.decidedBy ? `By ${ev.approval.decidedBy}` : ev.summary,
        timestamp: ev.timestamp,
      });
      continue;
    }
    if (t === "APPROVAL_REJECTED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "red", icon: XCircle, isRunning: false,
        title: "Approval rejected",
        subtitle: ev.approval?.decisionReason ?? ev.summary,
        timestamp: ev.timestamp,
      });
      continue;
    }

    // Tool calls — show one per completed tool (skip STARTED if COMPLETED follows)
    if (t === "TOOL_CALL_COMPLETED" || t === "HTTP_CALL_COMPLETED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "green", icon: eventIcon(ev), isRunning: false,
        title: ev.toolName ? `${ev.toolName} completed` : "Tool call completed",
        subtitle: `${ev.summary ?? ""}${fmtDuration(ev.durationMs)}`,
        timestamp: ev.timestamp,
      });
      continue;
    }
    if (t === "TOOL_CALL_FAILED" || t === "HTTP_CALL_FAILED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "red", icon: AlertTriangle, isRunning: false,
        title: ev.toolName ? `${ev.toolName} failed` : "Tool call failed",
        subtitle: ev.errorMessage ?? ev.summary,
        timestamp: ev.timestamp,
      });
      continue;
    }

    // Retries
    if (t === "RETRY_SCHEDULED" || t === "RETRY_STARTED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "amber", icon: RefreshCw, isRunning: false,
        title: "Retry attempted",
        subtitle: ev.summary,
        timestamp: ev.timestamp,
      });
      continue;
    }
    if (t === "RETRY_EXHAUSTED") {
      items.push({
        id: ev.id, rawEventId: ev.id, tone: "red", icon: AlertTriangle, isRunning: false,
        title: "Retries exhausted",
        subtitle: ev.summary,
        timestamp: ev.timestamp,
      });
      continue;
    }

    // Skip low-level noise in business view (LLM_CALL_STARTED, STEP_STARTED, etc.)
  }

  return items;
}

// ─── Engineering timeline mapper ──────────────────────────────────────────────
// Shows every event with full technical detail.

function buildEngineeringItems(events: RunTimelineEventUi[]): TimelineItem[] {
  return events.map(ev => ({
    id:         ev.id,
    rawEventId: ev.id,
    tone:       eventTone(ev),
    icon:       eventIcon(ev),
    isRunning:  ev.status === "RUNNING",
    title:      ev.title ?? ev.type,
    subtitle: [
      ev.stepName && `step: ${ev.stepName}`,
      ev.agentName,
      ev.toolName,
      ev.modelName,
      ev.tokensUsed && `${ev.tokensUsed.toLocaleString()} tokens`,
      ev.estimatedCostUsd && `$${ev.estimatedCostUsd.toFixed(4)}`,
      ev.errorMessage,
      ev.summary,
      ev.durationMs && fmtDuration(ev.durationMs),
    ].filter(Boolean).join(" · ") || undefined,
    timestamp: ev.timestamp,
    metadata: {
      stepId:    ev.stepId,
      source:    ev.source,
      inputJson: ev.inputJson,
      outputJson: ev.outputJson,
    } as Record<string, unknown>,
  }));
}

// ─── Timeline item component ──────────────────────────────────────────────────

function TimelineRow({
  item, isLast, isSelected, onClick, index,
}: {
  item: TimelineItem;
  isLast: boolean;
  isSelected: boolean;
  onClick: (id: string) => void;
  index: number;
}) {
  const tone = TONE[item.tone];
  const Icon = item.icon;

  return (
    <div
      className="relative flex gap-4 cursor-pointer"
      style={{
        paddingBottom: isLast ? 0 : 20,
        animationDelay: `${index * 40}ms`,
      }}
      onClick={() => onClick(item.rawEventId)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === "Enter" && onClick(item.rawEventId)}
    >
      {/* Vertical connector line */}
      {!isLast && (
        <div
          aria-hidden
          className="absolute left-[17px] top-9 bottom-0 w-px"
          style={{ background: "#E2E8F0" }}
        />
      )}

      {/* Icon circle */}
      <div
        className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ background: tone.badge, border: `1.5px solid ${tone.border}` }}
      >
        {item.isRunning ? (
          <Loader2
            className="animate-spin"
            style={{ width: 15, height: 15, color: tone.icon }}
          />
        ) : (
          <Icon style={{ width: 15, height: 15, color: tone.icon }} strokeWidth={1.75} />
        )}
        {/* Running pulse ring */}
        {item.isRunning && (
          <span
            aria-hidden
            className="absolute inset-0 animate-ping rounded-full opacity-30"
            style={{ background: tone.icon }}
          />
        )}
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex flex-1 items-start justify-between gap-3 rounded-xl px-3 py-2.5 min-w-0 transition-colors",
          isSelected ? "bg-blue-50 border border-blue-200" : "hover:bg-slate-50 border border-transparent",
        )}
      >
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[13px] font-semibold leading-snug"
            style={{ color: "#0F172A" }}
          >
            {item.title}
          </p>
          {item.subtitle && (
            <p
              className="mt-0.5 text-[11.5px] leading-snug text-slate-500"
              style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            >
              {item.subtitle}
            </p>
          )}
        </div>
        <span
          className="shrink-0 font-mono text-[11px] text-slate-400 tabular-nums mt-0.5"
        >
          {fmtTime(item.timestamp)}
        </span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface RunTimelineProps {
  events:      RunTimelineEventUi[];
  variant:     "business" | "engineering";
  selectedId?: string;
  onSelect?:   (rawEventId: string) => void;
  isLive?:     boolean;
}

export function RunTimeline({ events, variant, selectedId, onSelect, isLive }: RunTimelineProps) {
  const items = useMemo(
    () => variant === "business" ? buildBusinessItems(events) : buildEngineeringItems(events),
    [events, variant],
  );

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        {isLive ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
            <p className="text-[13px] font-medium text-slate-500">Waiting for events…</p>
          </>
        ) : (
          <p className="text-[13px] text-slate-400">No timeline events for this run.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-0 px-4 py-4">
      {/* Inject CSS animation once */}
      <style>{`
        @keyframes tl-fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .tl-item {
          animation: tl-fade-up 0.22s ease-out both;
        }
      `}</style>

      {items.map((item, i) => (
        <div key={item.id} className="tl-item" style={{ animationDelay: `${i * 40}ms` }}>
          <TimelineRow
            item={item}
            isLast={i === items.length - 1}
            isSelected={item.rawEventId === selectedId}
            onClick={(id) => onSelect?.(id)}
            index={i}
          />
        </div>
      ))}

      {isLive && (
        <div className="flex items-center gap-2 pt-2 pl-1">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          <span className="text-[11.5px] text-slate-400">Live — receiving events…</span>
        </div>
      )}
    </div>
  );
}
