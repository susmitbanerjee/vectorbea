"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import type { contracts } from "@vectorbea/shared";
import { LocalTime } from "~/components/ui/local-time";
import { describe } from "~/lib/runs/log-vocabulary";

/* ══════════════════════════════════════════════════════════════════════════════
   BAND 4 · LIVE ACTIVITY STREAM

   A tail of the event stream the engine actually executes from — runs starting,
   nodes committing, gates opening, failures landing. It makes an otherwise
   static page feel alive, and during an incident it is the fastest way to see
   whether things are still moving.

   PAUSES ON HOVER. A stream that keeps scrolling while you are trying to read a
   line is a stream you cannot use. Hovering, or focusing anything inside it,
   freezes it and says so.

   Reduced motion turns off the arrival animation but not the stream — the
   content updating is information, the slide is decoration.
══════════════════════════════════════════════════════════════════════════════ */

type ActivityKind = "run.started" | "node.committed" | "gate.opened" | "run.failed" | "run.succeeded" | "run.resumed";

const KIND_STYLE: Record<ActivityKind, { label: string; dot: string; text: string }> = {
  "run.started": { label: "started", dot: "bg-fg-muted", text: "text-fg-muted" },
  "node.committed": { label: "commit", dot: "bg-status-success", text: "text-status-success" },
  "gate.opened": { label: "gate", dot: "bg-status-waiting", text: "text-status-waiting" },
  "run.failed": { label: "failed", dot: "bg-status-failed", text: "text-status-failed" },
  "run.succeeded": { label: "done", dot: "bg-status-success", text: "text-status-success" },
  "run.resumed": { label: "resume", dot: "bg-status-live", text: "text-status-live" },
};

export interface ActivityStreamProps {
  events: contracts.ControlActivityEvent[];
  /** Frozen for screenshots and for the loading state. */
  paused?: boolean;
  refreshing?: boolean;
  autoRefresh?: boolean;
  onRefresh?: () => void;
  onAutoRefreshChange?: (enabled: boolean) => void;
  className?: string;
}

export function ActivityStream({
  events, paused = false, refreshing = false, autoRefresh, onRefresh,
  onAutoRefreshChange, className,
}: ActivityStreamProps) {
  const [hovered, setHovered] = React.useState(false);
  const [focusWithin, setFocusWithin] = React.useState(false);
  const [visibleEvents, setVisibleEvents] = React.useState(events);

  const reading = hovered || focusWithin;
  const frozen = paused || hovered || focusWithin;

  // Hold the rendered snapshot while somebody is reading it. Query refreshes
  // can still complete and populate the cache; they become visible on resume.
  React.useEffect(() => {
    if (!reading) setVisibleEvents(events);
  }, [events, reading]);

  return (
    <div
      className={cn("border-subtle bg-surface-raised overflow-hidden rounded-lg border", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      <div className="border-subtle flex items-center gap-2 border-b px-3 py-2">
        <span
          aria-hidden="true"
          data-motion="decorative"
          className={cn(
            "size-1.5 rounded-full",
            frozen ? "bg-fg-disabled" : "bg-status-live motion-safe:animate-[ink-bloom_2s_ease-in-out_infinite]",
          )}
        />
        <Text variant="eyebrow" tone="muted">Activity</Text>
        <Text variant="caption" tone="muted" className="ml-auto">
          {frozen ? (paused ? "Paused" : "Paused while you read") : "Live"}
        </Text>
        {autoRefresh !== undefined && onAutoRefreshChange ? (
          <button
            type="button"
            onClick={() => onAutoRefreshChange(!autoRefresh)}
            aria-pressed={autoRefresh}
            className={cn(
              "font-ui text-caption rounded-sm px-1.5 py-1 outline-none focus-visible:focus-ring",
              autoRefresh ? "text-accent" : "text-fg-muted hover:text-fg-primary",
            )}
          >
            Auto
          </button>
        ) : null}
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh activity"
            className="text-fg-muted hover:text-fg-primary grid size-6 place-items-center rounded-sm outline-none focus-visible:focus-ring disabled:opacity-50"
          >
            <svg viewBox="0 0 16 16" className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden="true" fill="none">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* aria-live is deliberately off. Re-announcing the list after every
          refresh makes a screen reader unusable; it remains reachable and
          readable on demand instead. */}
      <ul className="grid" aria-label="Recent activity">
        {visibleEvents.length === 0 ? (
          <li className="px-3 py-6 text-center">
            <Text variant="body-sm" tone="muted">No run activity yet.</Text>
          </li>
        ) : visibleEvents.slice(0, 9).map((event, i) => (
          <ActivityRow key={event.id} event={event} index={i} animate={!frozen} />
        ))}
      </ul>
    </div>
  );
}

function ActivityRow({ event, index, animate }: { event: contracts.ControlActivityEvent; index: number; animate: boolean }) {
  const kind = activityKind(event.type, event.status);
  const style = KIND_STYLE[kind];
  return (
    <li
      // Only the newest row animates in; re-animating the whole list on every
      // tick would be a wall of movement.
      className={cn(
        "border-subtle border-b last:border-b-0",
        index === 0 && animate && "motion-safe:animate-[ink-log-line_260ms_var(--ease-standard)]",
      )}
    >
      <Link
        href={`/runs/${event.runId}` as Route}
        className={cn(
          "flex items-center gap-2.5 px-3 py-1.5",
          "hover:bg-surface-hover transition-colors duration-fast",
          "outline-none focus-visible:focus-ring",
        )}
      >
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
        <span className={cn("font-code text-mono-sm w-14 shrink-0", style.text)}>{style.label}</span>
        <span className="font-ui text-body-sm text-fg-primary min-w-0 flex-1 truncate">
          {event.workflowName}
        </span>
        <span className="font-ui text-caption text-fg-muted hidden min-w-0 truncate sm:block">
          {event.title ?? describe(event.type)}
        </span>
        <span className="font-code text-mono-sm text-fg-disabled tabular shrink-0">
          <LocalTime at={event.timestamp} format="clock" />
        </span>
      </Link>
    </li>
  );
}

function activityKind(type: string, status?: string | null): ActivityKind {
  const value = type.toUpperCase();
  if (value.includes("FAIL") || value.includes("REJECT") || status === "failed") return "run.failed";
  if (value.includes("APPROVAL") || value.includes("GATE") || status === "waiting_for_approval") return "gate.opened";
  if (value.includes("RESUM") || value.includes("RECOVER") || value.includes("RETRY")) return "run.resumed";
  if (value.includes("SUCCEED") || value.includes("COMPLETED") || status === "completed") return value.includes("STEP") || value.includes("NODE") ? "node.committed" : "run.succeeded";
  if (value.includes("STEP") || value.includes("NODE") || value.includes("COMMIT")) return "node.committed";
  return "run.started";
}
