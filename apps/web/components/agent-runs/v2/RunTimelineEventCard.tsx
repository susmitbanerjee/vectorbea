"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Coins, Copy, User, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunTimelineEventUi } from "@/types/agent-run-ui";
import { EventTypeBadge, EventRailIcon, isCompactEvent } from "./EventTypeBadge";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtDur(ms?: number) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function JsonPreview({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const json = JSON.stringify(value, null, 2);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="font-mono">{label}</span>
        <span className="text-muted-foreground/50">({typeof value === "object" && value !== null
          ? Array.isArray(value) ? `${(value as unknown[]).length} items`
          : `${Object.keys(value).length} keys` : typeof value})</span>
      </button>
      {open && (
        <pre className="mt-1.5 max-h-48 overflow-auto rounded-md bg-[#0f0f0f] p-3 text-[11px] leading-relaxed text-[#e5e7eb] dark:bg-[#0a0a0a]">
          {json}
        </pre>
      )}
    </div>
  );
}

// ─── Main card ────────────────────────────────────────────────────────────────

interface RunTimelineEventCardProps {
  event: RunTimelineEventUi;
  isLast: boolean;
  defaultExpanded?: boolean;
  showDate?: boolean;
}

export function RunTimelineEventCard({ event, isLast, defaultExpanded = false, showDate = false }: RunTimelineEventCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const compact = isCompactEvent(event.type);
  const isFailed = event.status === "FAILED";
  const isWaiting = event.status === "WAITING";
  const hasDetails = event.inputJson !== undefined || event.outputJson !== undefined || event.metadataJson !== undefined || event.errorMessage;
  const dur = fmtDur(event.durationMs);

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex gap-0">
      {/* ── Rail ──────────────────────────────────────────────────────── */}
      <div className="flex w-9 shrink-0 flex-col items-center">
        <div className="mt-3">
          <EventRailIcon type={event.type} />
        </div>
        {!isLast && (
          <div className={cn(
            "mt-1 w-px flex-1",
            isFailed ? "bg-red-500/20" : isWaiting ? "bg-amber-500/20" : "bg-border/60",
          )} />
        )}
      </div>

      {/* ── Card ──────────────────────────────────────────────────────── */}
      <div className={cn("flex-1 min-w-0 pb-2", isLast && "pb-0")}>
        {showDate && (
          <p className="mb-1.5 text-[10px] font-mono font-semibold uppercase tracking-widest text-muted-foreground/40">
            {new Date(event.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </p>
        )}

        <div
          className={cn(
            "group rounded-lg border transition-all duration-150",
            isFailed
              ? "border-red-500/20 bg-red-500/[0.025]"
              : isWaiting
                ? "border-amber-500/20 bg-amber-500/[0.025]"
                : compact
                  ? "border-border/30 bg-transparent"
                  : "border-border/50 bg-card/40 hover:bg-card/70",
            hasDetails && !compact && "cursor-pointer",
          )}
          onClick={() => hasDetails && !compact && setExpanded(e => !e)}
          role={hasDetails && !compact ? "button" : undefined}
          tabIndex={hasDetails && !compact ? 0 : undefined}
          onKeyDown={e => { if (hasDetails && !compact && (e.key === "Enter" || e.key === " ")) setExpanded(v => !v); }}
        >
          {/* Header */}
          <div className={cn("flex items-start gap-2 px-3", compact ? "py-1.5" : "py-2.5")}>
            {/* Sequence */}
            <span className="mt-px w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground/30 select-none">
              {event.sequence}
            </span>

            {/* Type badge */}
            <EventTypeBadge type={event.type} />

            {/* Title + summary */}
            <div className="min-w-0 flex-1">
              <span className={cn(
                "text-[13px] font-medium leading-snug",
                isFailed ? "text-red-700 dark:text-red-300" :
                isWaiting ? "text-amber-700 dark:text-amber-300" :
                compact ? "text-muted-foreground" : "text-foreground",
              )}>
                {event.title}
              </span>
              {event.summary && !compact && (
                <p className={cn(
                  "mt-0.5 text-[12px] leading-snug",
                  isFailed ? "text-red-600/80 dark:text-red-400/80" :
                  isWaiting ? "text-amber-600/80 dark:text-amber-400/80" :
                  "text-muted-foreground",
                )}>
                  {event.actorName && (
                    <span className="inline-flex items-center gap-0.5 mr-1 font-medium">
                      <User className="inline h-3 w-3" /> {event.actorName} ·{" "}
                    </span>
                  )}
                  {event.agentName && (
                    <span className="font-mono text-[11px] text-violet-500 mr-1">[{event.agentName}]</span>
                  )}
                  {event.summary}
                </p>
              )}
            </div>

            {/* Right meta */}
            <div className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
              {event.tokensUsed && (
                <span className="hidden items-center gap-0.5 sm:flex">
                  <Zap className="h-3 w-3" />{event.tokensUsed.toLocaleString()}
                </span>
              )}
              {event.estimatedCostUsd && (
                <span className="hidden items-center gap-0.5 sm:flex">
                  <Coins className="h-3 w-3" />${event.estimatedCostUsd.toFixed(4)}
                </span>
              )}
              {dur && (
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />{dur}
                </span>
              )}
              <span className="font-mono text-[10px]">{fmtTime(event.timestamp)}</span>
              {hasDetails && !compact && (
                expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
              )}
            </div>
          </div>

          {/* Source strip */}
          {!compact && (
            <div className="flex items-center justify-between border-t border-border/30 px-3 py-1">
              <span className="text-[10px] font-mono text-muted-foreground/40">
                src:{event.source.toLowerCase()}
                {event.agentName && ` · ${event.agentName}`}
                {event.modelName && ` · model:${event.modelName}`}
                {event.toolName && ` · tool:${event.toolName}`}
              </span>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); void copyJson(); }}
                className="text-[10px] font-mono text-muted-foreground/40 hover:text-muted-foreground transition-colors"
              >
                {copied ? "copied ✓" : "copy json"}
              </button>
            </div>
          )}

          {/* Expanded details */}
          {expanded && hasDetails && (
            <div className="border-t border-border/30 px-3 py-3 space-y-2">
              {event.errorMessage && (
                <div className="rounded-md border border-red-500/20 bg-red-500/[0.04] px-3 py-2.5">
                  <p className="mb-1 text-[10px] font-mono font-semibold uppercase tracking-wide text-red-500">Error</p>
                  <p className="font-mono text-[11px] text-red-600 dark:text-red-400 break-all">{event.errorMessage}</p>
                </div>
              )}
              {event.approval && (
                <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-wide text-amber-500">Approval</p>
                  <p className="text-[12px] text-foreground font-medium">{event.approval.title}</p>
                  <p className="text-[12px] text-muted-foreground">{event.approval.message}</p>
                  {event.approval.decisionReason && (
                    <p className="text-[12px] text-muted-foreground italic">&ldquo;{event.approval.decisionReason}&rdquo;</p>
                  )}
                </div>
              )}
              {event.inputJson !== undefined && <JsonPreview label="input" value={event.inputJson} />}
              {event.outputJson !== undefined && <JsonPreview label="output" value={event.outputJson} />}
              {event.metadataJson !== undefined && <JsonPreview label="metadata" value={event.metadataJson} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
