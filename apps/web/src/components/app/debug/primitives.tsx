"use client";

import * as React from "react";
import { Icon } from "~/components/ui/icon";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { formatDuration } from "~/lib/format";
import {
  SEGMENT, TONE, type SpanTone, toneForNodeStatus, warningStyle,
} from "./status-vocabulary";
import type { GraphWarning } from "~/lib/api/trace";

/**
 * The pieces every Debug view is assembled from.
 *
 * ── WHY THESE ARE SHARED AND NOT COPIED ─────────────────────────────────────
 * Four views render the same five facts: what a node is called, what happened to
 * it, how long it took, what is still worth knowing about it, and whether the
 * trace can be trusted. When each view spells those out itself they drift — and
 * they had: the map labelled nodes by TYPE while the inspector used the label,
 * so the same node was "Agent" in one view and "researcher" in the next.
 *
 * Every one of these takes its colours, icons and words from
 * [status-vocabulary], never from a literal at the call site.
 */

// ── NodeLabel ───────────────────────────────────────────────────────────────

/**
 * A node's name, never a bare type.
 *
 * The server resolves the fallback chain (label → agent name → "Type · id8"),
 * because it is the only side that can see the graph. This renders what it was
 * given and adds the one thing the server cannot: whether this is the node the
 * reader is looking for.
 */
export function NodeLabel({
  label, muted, emphasis, className,
}: {
  label: string;
  muted?: boolean;
  /** The failing path. Bold, so the eye lands on the chain that broke. */
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "truncate text-xs",
        emphasis ? "font-semibold text-fg-max" : "font-medium",
        muted ? "text-fg-disabled" : !emphasis && "text-fg-primary",
        className,
      )}
      title={label}
    >
      {label}
    </span>
  );
}

// ── StatusPill ──────────────────────────────────────────────────────────────

/**
 * Status as icon + word, in that order, with colour third.
 *
 * The word is the accessible name and the icon is the redundant encoding beside
 * it — so the pill still reads correctly in greyscale, at 200% zoom, and to
 * somebody who cannot separate the red from the green this whole page is built
 * on. `size="dot"` drops to a swatch for dense rows, and there the STATUS WORD
 * moves into the accessible label rather than disappearing.
 */
export function StatusPill({
  status, size = "sm", className,
}: {
  status: string;
  size?: "dot" | "sm";
  className?: string;
}) {
  const tone = toneForNodeStatus(status);
  const t = TONE[tone];

  if (size === "dot") {
    return (
      <span
        role="img"
        aria-label={t.label}
        className={cn("inline-block size-1.5 shrink-0 rounded-full", t.solid, className)}
      />
    );
  }

  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-xs px-1 py-0.5",
        t.fill, t.text, className)}
    >
      <Icon icon={t.icon} size="xs" decorative />
      <span className="text-[10px] font-medium">{t.label}</span>
    </span>
  );
}

// ── DurationBar ─────────────────────────────────────────────────────────────

/**
 * Duration encoded as WIDTH, with the number beside it.
 *
 * Rule 3: duration is spatial, not only textual. A 1ms step and a 65s step
 * rendered at the same size, with the difference available only by reading two
 * monospace numbers, is a table pretending to be a picture.
 *
 * ── WHY SQUARE ROOT ─────────────────────────────────────────────────────────
 * Linear against the slowest node makes one 10-minute model call swallow the
 * scale: everything else collapses onto the floor and is the same size again,
 * which is the thing the encoding exists to prevent. The square root compresses
 * the top and keeps the bottom separable, so 3ms and 400ms stay distinguishable
 * next to a node that took a minute.
 *
 * Both bounds are the caller's: the map and the minimap want different ones, and
 * a function that knew about only one of them would be re-derived for the other.
 */
export function scaleWidth(
  ms: number | null | undefined,
  slowestMs: number,
  min: number,
  max: number,
): number {
  if (ms == null || ms <= 0 || slowestMs <= 0) return min;
  const ratio = Math.sqrt(Math.min(ms, slowestMs) / slowestMs);
  /* Snapped to the 4px lattice, like every other size in the system. */
  return Math.round(Math.min(min + ratio * (max - min), max) / 4) * 4;
}

/**
 * How much bigger the slowest node has to be before its width is a lie.
 *
 * ── WHAT "CLAMPED" HONESTLY MEANS ───────────────────────────────────────────
 * The first version marked a node when its computed width exceeded the ceiling —
 * which could never happen, because the slowest node IS the ceiling. A flag that
 * cannot fire is worse than no flag: it reads as a guarantee that nothing is
 * being compressed.
 *
 * The real distortion is the square root. When one node took four times longer
 * than everything else, it is drawn under three times wider, and the picture
 * cannot show by how much it dominates. That is the case worth marking, and it
 * needs to know about the OTHER nodes — so the decision lives in the layout,
 * which has them, and not in the scale, which does not.
 */
export const DOMINANCE_FACTOR = 4;

export function DurationBar({
  ms, slowestMs, tone, className,
}: {
  ms: number | null;
  slowestMs: number;
  tone: SpanTone;
  className?: string;
}) {
  const pct = ms == null || slowestMs <= 0
    ? 0
    : Math.max(2, Math.min(100, (ms / slowestMs) * 100));
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-surface-sunken", className)}>
      <div
        aria-hidden="true"
        className={cn("h-full rounded-full", TONE[tone].solid)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── WarningMarkers ──────────────────────────────────────────────────────────

/**
 * What a healthy-looking node still has to answer for.
 *
 * Retries, truncated context and clamped budgets all leave a run green. Without
 * these a successful run has nothing to show, and "it worked" and "it worked
 * this time" render identically.
 *
 * Amber at most, never red: none of these failed anything, and borrowing the
 * failure colour for them is how a page teaches people to ignore red.
 */
export function WarningMarkers({
  warnings, className,
}: {
  warnings: GraphWarning[];
  className?: string;
}) {
  if (warnings.length === 0) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {warnings.map((w) => {
        const s = warningStyle(w.kind);
        const text = w.count > 1 ? `${s.label} ${w.count}×` : s.label;
        return (
          <span
            key={w.kind}
            title={w.detail}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-xs border px-1",
              s.tone === "waiting"
                ? "border-status-waiting-border text-status-waiting"
                : "border-subtle text-fg-secondary",
            )}
          >
            <Icon icon={s.icon} size="xs" decorative />
            <span className="text-[10px] font-medium tabular-nums">{text}</span>
            {/* The detail is the accessible name: a tooltip is not reachable
                by keyboard or screen reader, so it can never be the only copy. */}
            <span className="sr-only">. {text}: {w.detail}</span>
          </span>
        );
      })}
    </span>
  );
}

// ── RunBar ──────────────────────────────────────────────────────────────────

/**
 * Where the wall clock went — the single most common misreading of a run.
 *
 * "This took 4 minutes" is heard as "the product worked for 4 minutes". Usually
 * it worked for 68 seconds and sat parked for 2m38s waiting for a human to click
 * approve. Those are opposite problems — one is engineering, one is process —
 * and the run header gives them the same number.
 *
 * Segments are proportional and labelled UNDERNEATH with real durations, so the
 * shape answers at a glance and the numbers answer precisely. A segment too
 * narrow to label still shows in the bar and in the legend, because dropping it
 * would silently change what the bar adds up to.
 */
export function RunBar({
  totalMs, segments,
}: {
  totalMs: number;
  segments: Array<{ kind: string; ms: number; label: string }>;
}) {
  if (totalMs <= 0 || segments.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken"
        role="img"
        aria-label={
          `Run took ${formatDuration(totalMs)}: ` +
          segments.map((s) => `${s.label} ${formatDuration(s.ms)}`).join(", ")
        }
      >
        {segments.map((s) => (
          <div
            key={s.kind}
            /* Proportion is the whole message, so it cannot be a utility class. */
            style={{ width: `${(s.ms / totalMs) * 100}%` }}
            className={cn(SEGMENT[s.kind]?.solid ?? "bg-fg-disabled",
              /* A hairline between segments so two adjacent bands are separable
                 without relying on the hue difference alone. */
              "border-r border-bg-base last:border-r-0")}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.kind} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("size-2 shrink-0 rounded-xs", SEGMENT[s.kind]?.solid ?? "bg-fg-disabled")}
            />
            <Text variant="caption" className="text-fg-secondary">{s.label}</Text>
            <span className="font-mono text-[11px] tabular-nums text-fg-max">
              {formatDuration(s.ms)}
            </span>
            <Text variant="caption" className="text-fg-muted tabular-nums">
              {Math.round((s.ms / totalMs) * 100)}%
            </Text>
          </span>
        ))}
      </div>
    </div>
  );
}
