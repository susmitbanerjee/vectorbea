"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Coins, User, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunTimelineEvent } from "@/lib/run-timeline";
import { EventTypeBadge, EventTypeDot, getEventTypeConfig } from "./EventTypeBadge";
import { JsonBlock } from "./JsonBlock";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function fmtDur(ms: number | undefined) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

const SOURCE_LABEL: Record<string, string> = {
  SYSTEM: "System",
  SCHEDULER: "Scheduler",
  WORKER: "Worker",
  AGENT: "Agent",
  HUMAN: "Human",
  API: "API",
};

// ─── Compact system events ─────────────────────────────────────────────────────

const COMPACT_TYPES = new Set([
  "RUN_CREATED",
  "RUN_QUEUED",
  "BUDGET_CHECK_PASSED",
  "POLICY_CHECK_PASSED",
  "RUN_RESUMED",
]);

// ─── Single event card ────────────────────────────────────────────────────────

interface RunTimelineEventCardProps {
  event: RunTimelineEvent;
  isLast: boolean;
  /** Show date prefix if date differs from previous event */
  showDate?: boolean;
}

export function RunTimelineEventCard({
  event,
  isLast,
  showDate = false,
}: RunTimelineEventCardProps) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getEventTypeConfig(event.type);
  const isCompact = COMPACT_TYPES.has(event.type);
  const hasDetails =
    event.inputJson !== undefined ||
    event.outputJson !== undefined ||
    event.metadataJson !== undefined ||
    event.errorMessage;

  const dur = fmtDur(event.durationMs);
  const isFailed = event.status === "FAILED";
  const isWaiting = event.status === "WAITING";

  return (
    <div className="flex gap-0">
      {/* ── Rail column ────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center w-10 shrink-0 pt-0.5">
        <EventTypeDot type={event.type} className="mt-1" />
        {!isLast && (
          <div
            className={cn(
              "w-px flex-1 mt-1",
              isFailed ? "bg-red-500/30" : isWaiting ? "bg-amber-500/30" : "bg-border",
            )}
          />
        )}
      </div>

      {/* ── Event content ─────────────────────────────────────────────────── */}
      <div className={cn("flex-1 pb-3", isLast ? "pb-0" : "")}>
        {/* Date separator */}
        {showDate && (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">
            {fmtDate(event.timestamp)}
          </p>
        )}

        {/* Card */}
        <div
          className={cn(
            "rounded-lg border transition-colors",
            isFailed
              ? "border-red-500/20 bg-red-500/[0.03]"
              : isWaiting
                ? "border-amber-500/20 bg-amber-500/[0.03]"
                : "border-border/60 bg-card/60",
            hasDetails && "cursor-pointer hover:bg-muted/20",
            isCompact && "bg-transparent border-dashed border-border/40",
          )}
          onClick={() => hasDetails && setExpanded((e) => !e)}
          role={hasDetails ? "button" : undefined}
          tabIndex={hasDetails ? 0 : undefined}
          onKeyDown={(e) => {
            if (hasDetails && (e.key === "Enter" || e.key === " ")) setExpanded((v) => !v);
          }}
        >
          {/* Header row */}
          <div className="flex flex-wrap items-start gap-2 px-3 py-2.5">
            {/* Sequence number */}
            <span className="mt-px text-[10px] font-mono text-muted-foreground/40 w-5 shrink-0 text-right select-none">
              {event.sequence}
            </span>

            {/* Type badge */}
            <EventTypeBadge type={event.type} />

            {/* Title */}
            <span
              className={cn(
                "flex-1 text-sm font-medium leading-snug",
                isFailed ? "text-red-700" : "text-foreground",
              )}
            >
              {event.title}
            </span>

            {/* Right meta */}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground shrink-0 ml-auto">
              {dur && (
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />
                  {dur}
                </span>
              )}
              {event.tokensUsed && (
                <span className="flex items-center gap-0.5">
                  <Zap className="h-3 w-3" />
                  {event.tokensUsed.toLocaleString()}
                </span>
              )}
              {event.estimatedCostUsd && (
                <span className="flex items-center gap-0.5">
                  <Coins className="h-3 w-3" />
                  ${event.estimatedCostUsd.toFixed(4)}
                </span>
              )}
              <span className="font-mono">{fmtTime(event.timestamp)}</span>
              {hasDetails && (
                <span>
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Summary line */}
          {event.summary && (
            <p
              className={cn(
                "px-3 pb-2.5 text-xs leading-relaxed",
                isFailed
                  ? "text-red-600"
                  : isWaiting
                    ? "text-amber-600"
                    : "text-muted-foreground",
                // For compact events, inline the summary on the same visual row
                isCompact && "pt-0",
              )}
            >
              {event.actorName && (
                <span className="inline-flex items-center gap-1 mr-1">
                  <User className="h-3 w-3" />
                  <span className="font-medium">{event.actorName}</span>
                  {" · "}
                </span>
              )}
              {event.summary}
            </p>
          )}

          {/* Source chip (skip for compact system events) */}
          {!isCompact && (
            <div className="flex items-center gap-2 border-t border-border/40 px-3 py-1.5">
              <span className="text-[10px] text-muted-foreground/50">Source:</span>
              <span className="text-[10px] font-medium text-muted-foreground">
                {SOURCE_LABEL[event.source] ?? event.source}
              </span>
            </div>
          )}

          {/* Expanded details */}
          {expanded && hasDetails && (
            <div className="border-t border-border/50 px-3 py-3 space-y-2">
              {event.errorMessage && (
                <div className="rounded-md bg-red-500/[0.06] border border-red-500/20 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-red-500 mb-1">
                    Error
                  </p>
                  <p className="text-xs font-mono text-red-600 break-words">
                    {event.errorMessage}
                  </p>
                </div>
              )}
              {event.inputJson !== undefined && (
                <JsonBlock label="Input" value={event.inputJson} />
              )}
              {event.outputJson !== undefined && (
                <JsonBlock label="Output" value={event.outputJson} />
              )}
              {event.metadataJson !== undefined && (
                <JsonBlock label="Metadata" value={event.metadataJson} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
