"use client";

import * as React from "react";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import type { TraceSpan } from "~/lib/api/trace";
import {
  KIND_LABEL, TONE_CLASSES, TONE_FOR_STATUS, TONE_LABEL,
  formatDuration, waitReasonOf,
} from "./span-status";

/** A span flattened for rendering, with its depth and position on the axis. */
interface Row {
  span: TraceSpan;
  depth: number;
  /** Fraction of the run's span, 0..1. */
  left: number;
  width: number;
  onCriticalPath: boolean;
}

const ROW_HEIGHT = 28;
/** Rows rendered beyond the viewport, so a fast scroll does not show blanks. */
const OVERSCAN = 12;

/**
 * The waterfall: every span on one time axis, indented by containment.
 *
 * VIRTUALISED, AND NOT OPTIONALLY.
 * A 2000-span trace is 2000 DOM nodes with absolute positioning and a hatched
 * background on some of them. Rendering all of it locks the main thread on
 * mount, and every brush-zoom re-lays-out the whole tree. Only the rows in view
 * (plus [OVERSCAN]) are in the DOM; the container is sized by arithmetic so the
 * scrollbar is still honest about how much there is.
 *
 * Deliberately hand-rolled rather than pulling in a virtualiser: the repo asks
 * before new dependencies, and the requirement here is one fixed-height list
 * with no dynamic measurement — which is the case a library is least needed for.
 */
export function TimelineView({
  spans,
  criticalPathIds,
  selectedSpanId,
  onSelectSpan,
}: {
  spans: TraceSpan[];
  criticalPathIds: Set<string>;
  selectedSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(480);

  /** Brush zoom, as a fraction of the full run: [start, end]. */
  const [zoom, setZoom] = React.useState<[number, number]>([0, 1]);

  // ── Flatten once per data change, not per render ─────────────────────────
  const { rows, t0, totalMs } = React.useMemo(() => {
    const flat: Row[] = [];
    let min = Number.POSITIVE_INFINITY;
    let max = 0;

    const measure = (list: TraceSpan[]) =>
      list.forEach((s) => {
        const start = Date.parse(s.startedAt);
        const end = s.endedAt ? Date.parse(s.endedAt) : start + (s.durationMs ?? 0);
        if (Number.isFinite(start)) min = Math.min(min, start);
        max = Math.max(max, end);
        measure(s.children);
      });
    measure(spans);

    const span = Math.max(1, max - min);
    const walk = (list: TraceSpan[], depth: number) =>
      list.forEach((s) => {
        const start = Date.parse(s.startedAt);
        const dur = s.durationMs ?? (s.endedAt ? Date.parse(s.endedAt) - start : 0);
        flat.push({
          span: s,
          depth,
          left: (start - min) / span,
          /* A floor of 0.2% so a 3ms call is still a visible mark. A bar nobody
             can see is a span nobody knows ran. */
          width: Math.max(0.002, dur / span),
          onCriticalPath: criticalPathIds.has(s.spanId),
        });
        walk(s.children, depth + 1);
      });
    walk(spans, 0);

    return { rows: flat, t0: min, totalMs: span };
  }, [spans, criticalPathIds]);

  // ── Only what is on screen ────────────────────────────────────────────────
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
  const visible = rows.slice(first, last);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const [zStart, zEnd] = zoom;
  const zSpan = Math.max(0.0001, zEnd - zStart);
  const project = (v: number) => (v - zStart) / zSpan;

  if (rows.length === 0) {
    return (
      <EmptyTimeline />
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <AxisHeader
        totalMs={totalMs}
        zoom={zoom}
        onZoom={setZoom}
        spanCount={rows.length}
      />

      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="relative flex-1 overflow-auto rounded-md border border-subtle bg-surface-raised"
        role="tree"
        aria-label={`Waterfall, ${rows.length} spans`}
      >
        {/* Sized by arithmetic so the scrollbar reflects the whole trace even
            though only a window of it exists in the DOM. */}
        <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
          {visible.map((row, i) => {
            const idx = first + i;
            const tone = TONE_FOR_STATUS[row.span.status];
            const isWait = row.span.kind === "wait";
            const left = project(row.left);
            const width = row.width / zSpan;
            const selected = row.span.spanId === row.span.spanId && selectedSpanId === row.span.spanId;

            // Entirely outside the brush window — skip the bar, keep the row.
            const offscreen = left + width < 0 || left > 1;

            return (
              <div
                key={row.span.spanId}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={selected}
                tabIndex={0}
                onClick={() => onSelectSpan(row.span.spanId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectSpan(row.span.spanId);
                  }
                }}
                style={{ top: idx * ROW_HEIGHT, height: ROW_HEIGHT }}
                className={cn(
                  "absolute inset-x-0 flex cursor-pointer items-center gap-2 px-2",
                  "transition-opacity hover:opacity-90 motion-reduce:transition-none",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2",
                  "focus-visible:outline-border-focus",
                  selected && "bg-surface-selected",
                )}
              >
                {/* Label, indented by containment. */}
                <div
                  className="flex w-64 shrink-0 items-center gap-1.5 truncate"
                  style={{ paddingLeft: row.depth * 12 }}
                >
                  <span
                    aria-hidden="true"
                    className={cn("size-1.5 shrink-0 rounded-full", TONE_CLASSES[tone].dot)}
                  />
                  <span className="truncate text-xs text-fg-primary">
                    {isWait ? waitReasonOf(row.span) : row.span.name}
                  </span>
                </div>

                {/* The bar track. */}
                <div className="relative h-4 flex-1">
                  {!offscreen && (
                    <div
                      className={cn(
                        "absolute h-4 rounded-xs",
                        isWait
                          ? // Hatched: parked time must read as parked, not as work
                            // and not as a hang. The stripe is generated from the
                            // status token, so it stays correct in both themes.
                            "bg-[repeating-linear-gradient(45deg,var(--status-waiting-subtle)_0,var(--status-waiting-subtle)_4px,transparent_4px,transparent_8px)] border border-status-waiting-border"
                          : cn(TONE_CLASSES[tone].fill, "border", TONE_CLASSES[tone].border),
                        // The critical path is what determined total duration.
                        // Anything off it is wasted optimisation effort.
                        row.onCriticalPath && "ring-1 ring-inset ring-fg-max",
                      )}
                      style={{
                        left: `${Math.max(0, left) * 100}%`,
                        width: `${Math.min(1, width + Math.min(0, left)) * 100}%`,
                      }}
                      title={`${KIND_LABEL[row.span.kind] ?? row.span.kind} · ${TONE_LABEL[tone]} · ${formatDuration(row.span.durationMs)}`}
                    />
                  )}
                </div>

                <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-fg-muted">
                  {formatDuration(row.span.durationMs)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Legend />
    </div>
  );
}

/** Time axis plus the brush. */
function AxisHeader({
  totalMs, zoom, onZoom, spanCount,
}: {
  totalMs: number;
  zoom: [number, number];
  onZoom: (z: [number, number]) => void;
  spanCount: number;
}) {
  const ticks = 6;
  const [zStart, zEnd] = zoom;
  const windowMs = totalMs * (zEnd - zStart);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Text variant="caption" className="text-fg-muted">
          {spanCount} spans · {formatDuration(totalMs)} total
        </Text>
        {(zStart > 0 || zEnd < 1) && (
          <button
            type="button"
            onClick={() => onZoom([0, 1])}
            className={cn(
              "rounded-xs px-2 py-0.5 text-xs text-fg-link",
              "transition-opacity hover:opacity-80 motion-reduce:transition-none",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              "focus-visible:outline-border-focus",
            )}
          >
            Reset zoom
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 pl-[17rem] pr-16">
        <div className="relative h-5 flex-1 border-b border-subtle">
          {Array.from({ length: ticks + 1 }, (_, i) => (
            <span
              key={i}
              className="absolute -translate-x-1/2 font-mono text-[10px] tabular-nums text-fg-muted"
              style={{ left: `${(i / ticks) * 100}%` }}
            >
              {formatDuration((windowMs * i) / ticks)}
            </span>
          ))}
        </div>
      </div>

      {/* Brush. Two range inputs rather than a drag surface: keyboard-operable
          for free, which a canvas brush is not. */}
      <div className="flex items-center gap-2 pl-[17rem] pr-16">
        <label className="sr-only" htmlFor="brush-start">Zoom window start</label>
        <input
          id="brush-start"
          type="range" min={0} max={0.99} step={0.01} value={zStart}
          onChange={(e) => onZoom([Math.min(Number(e.target.value), zEnd - 0.01), zEnd])}
          className="h-1 flex-1 accent-[color:var(--fg-link)]"
        />
        <label className="sr-only" htmlFor="brush-end">Zoom window end</label>
        <input
          id="brush-end"
          type="range" min={0.01} max={1} step={0.01} value={zEnd}
          onChange={(e) => onZoom([zStart, Math.max(Number(e.target.value), zStart + 0.01)])}
          className="h-1 flex-1 accent-[color:var(--fg-link)]"
        />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2">
      {(["success", "failed", "waiting", "running", "skipped"] as const).map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE_CLASSES[t].dot)} />
          <span className="text-xs text-fg-muted">{TONE_LABEL[t]}</span>
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-2 w-4 rounded-xs border border-status-waiting-border bg-[repeating-linear-gradient(45deg,var(--status-waiting-subtle)_0,var(--status-waiting-subtle)_3px,transparent_3px,transparent_6px)]"
        />
        <span className="text-xs text-fg-muted">Parked (not running)</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-4 rounded-xs ring-1 ring-inset ring-fg-max" />
        <span className="text-xs text-fg-muted">Critical path</span>
      </span>
    </div>
  );
}

function EmptyTimeline() {
  return (
    <div className="flex h-48 items-center justify-center rounded-md border border-subtle bg-surface-raised">
      <div className="text-center">
        <Text variant="body" className="text-fg-secondary">No spans for this run.</Text>
        <Text variant="caption" className="mt-1 text-fg-muted">
          Runs from before tracing was enabled have no waterfall.
        </Text>
      </div>
    </div>
  );
}
