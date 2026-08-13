"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { buildActivity, type ActivityEvent, type ActivityKind } from "~/mocks/control";

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

const KIND_STYLE: Record<ActivityKind, { label: string; dot: string; text: string }> = {
  "run.started": { label: "started", dot: "bg-fg-muted", text: "text-fg-muted" },
  "node.committed": { label: "commit", dot: "bg-status-success", text: "text-status-success" },
  "gate.opened": { label: "gate", dot: "bg-status-waiting", text: "text-status-waiting" },
  "run.failed": { label: "failed", dot: "bg-status-failed", text: "text-status-failed" },
  "run.succeeded": { label: "done", dot: "bg-status-success", text: "text-status-success" },
  "run.resumed": { label: "resume", dot: "bg-status-live", text: "text-status-live" },
};

const VISIBLE = 9;
const TICK_MS = 2_600;

export interface ActivityStreamProps {
  /** Frozen for screenshots and for the loading state. */
  paused?: boolean;
  className?: string;
}

export function ActivityStream({ paused = false, className }: ActivityStreamProps) {
  const [offset, setOffset] = React.useState(0);
  const [hovered, setHovered] = React.useState(false);
  const [focusWithin, setFocusWithin] = React.useState(false);

  const frozen = paused || hovered || focusWithin;

  React.useEffect(() => {
    if (frozen) return;
    const id = window.setInterval(() => setOffset((o) => o + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [frozen]);

  const events = React.useMemo(() => buildActivity(VISIBLE, offset), [offset]);

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
      </div>

      {/* aria-live is deliberately off. A stream announcing nine lines every
          2.6 seconds makes a screen reader unusable; the list is reachable and
          readable on demand instead. */}
      <ul className="grid" aria-label="Recent activity">
        {events.map((event, i) => (
          <ActivityRow key={event.id} event={event} index={i} animate={!frozen} />
        ))}
      </ul>
    </div>
  );
}

function ActivityRow({ event, index, animate }: { event: ActivityEvent; index: number; animate: boolean }) {
  const style = KIND_STYLE[event.kind];
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
        href={event.href as Route}
        className={cn(
          "flex items-center gap-2.5 px-3 py-1.5",
          "hover:bg-surface-hover transition-colors duration-fast",
          "outline-none focus-visible:focus-ring",
        )}
      >
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
        <span className={cn("font-code text-mono-sm w-14 shrink-0", style.text)}>{style.label}</span>
        <span className="font-ui text-body-sm text-fg-primary min-w-0 flex-1 truncate">
          {event.subject}
        </span>
        <span className="font-ui text-caption text-fg-muted hidden min-w-0 truncate sm:block">
          {event.detail}
        </span>
        <span className="font-code text-mono-sm text-fg-disabled tabular shrink-0">
          {new Date(event.at).toLocaleTimeString("en-GB", {
            hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC",
          })}
        </span>
      </Link>
    </li>
  );
}
