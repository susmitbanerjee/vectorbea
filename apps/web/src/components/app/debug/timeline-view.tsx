"use client";

import * as React from "react";
import { CaretDown, CaretRight, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { Icon } from "~/components/ui/icon";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { formatDuration } from "~/lib/format";
import type { TraceSpan } from "~/lib/api/trace";
import { KIND_LABEL, TONE, TONE_FOR_STATUS, waitReasonOf } from "./status-vocabulary";
import {
  OVERSCAN, ROW_HEIGHT,
  coverage, flattenRows, projectBar, runWindow, tickMarkers, visibleRange,
  type WaterfallRow,
} from "./waterfall";

/**
 * The waterfall: every span on one time axis, indented by containment.
 *
 * ── THE THREE THINGS THIS VIEW HAS TO GET RIGHT ─────────────────────────────
 *
 * 1. PARKED TIME MUST READ AS PARKED. A `wait` span is hatched and labelled
 *    with its reason. An unlabelled bar in a waterfall reads as work, and a
 *    four-minute run that was really 68 seconds of work and 2m38s waiting for a
 *    human then reads as a slow product.
 *
 * 2. MISSING TIME MUST READ AS MISSING. A stretch of run with no span over it
 *    is drawn as an `Unaccounted` row, never as whitespace. Whitespace says
 *    "nothing was happening", which is precisely what a lost span looks like —
 *    so the bug hides behind the shape of the answer. Named, it gets fixed.
 *
 * 3. CONCURRENCY MUST READ AS CONCURRENCY. Bars are positioned by absolute
 *    time, so three activations that ran together share the same stretch of
 *    axis. Laying rows out sequentially — one slice each — would say the
 *    supervisor worked through them one at a time.
 *
 * Virtualised, and not optionally: a 2000-span trace is 2000 absolutely
 * positioned nodes, several with a generated hatch. Only the rows in view plus
 * an overscan are in the DOM; the container is sized by arithmetic so the
 * scrollbar stays honest about how much there is.
 *
 * Hand-rolled rather than pulling in a virtualiser: the repo asks before new
 * dependencies, and this is one fixed-height list with no dynamic measurement —
 * the case a library is least needed for.
 */

/** Label column, track, duration column. One definition, three consumers. */
const GRID = "grid grid-cols-[16rem_1fr_4.5rem] items-center gap-2";

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
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [pathOnly, setPathOnly] = React.useState(false);
  const [hover, setHover] = React.useState<{ row: WaterfallRow; x: number; y: number } | null>(null);

  const { totalMs } = React.useMemo(() => runWindow(spans), [spans]);
  const cov = React.useMemo(() => coverage(spans), [spans]);
  const ticks = React.useMemo(() => tickMarkers(spans), [spans]);

  const rows = React.useMemo(
    () => flattenRows(spans, {
      criticalPathIds, collapsed, criticalPathOnly: pathOnly, gaps: cov.gaps,
    }),
    [spans, criticalPathIds, collapsed, pathOnly, cov.gaps],
  );

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => setViewportH(el.clientHeight);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* One state update per frame. A scroll fires far more often than the screen
     refreshes, and every update re-renders the row window. */
  const frame = React.useRef(0);
  const onScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setScrollTop(top);
    });
  }, []);
  React.useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  const [first, last] = visibleRange(rows.length, scrollTop, viewportH);
  const visible = rows.slice(first, last);

  const toggle = React.useCallback((spanId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(spanId)) next.add(spanId);
      return next;
    });
  }, []);

  if (rows.length === 0 && spans.length === 0) return <EmptyTimeline />;

  return (
    <div className="flex h-full flex-col gap-2">
      <Header
        totalMs={totalMs}
        spanCount={rows.length}
        coverage={cov}
        zoom={zoom}
        onZoom={setZoom}
        pathOnly={pathOnly}
        onPathOnly={setPathOnly}
        hasCriticalPath={criticalPathIds.size > 0}
        ticks={ticks}
      />

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative flex-1 overflow-auto rounded-md border border-subtle bg-surface-raised"
        role="tree"
        aria-label={`Waterfall, ${rows.length} rows`}
      >
        {/* Sized by arithmetic so the scrollbar reflects the whole trace even
            though only a window of it is in the DOM. */}
        <div style={{ height: Math.max(rows.length * ROW_HEIGHT, 1) }} className="relative">
          {/* Tick seams, behind the rows. A run that yielded is several ticks
              with a hole between them; without the seams the reader sees one
              long bar with gaps and reads them as a hang. */}
          <TickSeams ticks={ticks} totalMs={totalMs} zoom={zoom} />

          {visible.map((row, i) => (
            <Row
              key={row.key}
              row={row}
              top={(first + i) * ROW_HEIGHT}
              totalMs={totalMs}
              zoom={zoom}
              selected={row.span != null && row.span.spanId === selectedSpanId}
              onSelect={() => row.span && onSelectSpan(row.span.spanId)}
              onToggle={() => row.span && toggle(row.span.spanId)}
              onHover={setHover}
            />
          ))}
        </div>
      </div>

      {hover && <HoverCard hover={hover} />}
      <Legend hasGaps={cov.gaps.length > 0} />
    </div>
  );
}

// ── One row ─────────────────────────────────────────────────────────────────

function Row({
  row, top, totalMs, zoom, selected, onSelect, onToggle, onHover,
}: {
  row: WaterfallRow;
  top: number;
  totalMs: number;
  zoom: readonly [number, number];
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onHover: (h: { row: WaterfallRow; x: number; y: number } | null) => void;
}) {
  const bar = projectBar(row, totalMs, zoom);
  const isGap = row.kind === "gap";
  const span = row.span;
  const tone = span ? TONE[TONE_FOR_STATUS[span.status]] : null;
  const isWait = span?.kind === "wait";

  const label = isGap
    ? "Unaccounted"
    : isWait
      ? waitReasonOf(span!)
      : span!.name;

  const durationMs = isGap ? row.endMs - row.startMs : span!.durationMs;

  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={row.hasChildren ? !row.collapsed : undefined}
      tabIndex={isGap ? -1 : 0}
      onClick={isGap ? undefined : onSelect}
      onKeyDown={(e) => {
        if (isGap) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }
        /* Arrow keys collapse and expand, the way a tree is expected to. */
        if (e.key === "ArrowLeft" && row.hasChildren && !row.collapsed) { e.preventDefault(); onToggle(); }
        if (e.key === "ArrowRight" && row.hasChildren && row.collapsed) { e.preventDefault(); onToggle(); }
      }}
      onMouseEnter={(e) => onHover({ row, x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => onHover({ row, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onHover(null)}
      style={{ top, height: ROW_HEIGHT }}
      className={cn(
        "absolute inset-x-0 px-2", GRID,
        !isGap && "cursor-pointer",
        "transition-opacity hover:opacity-90 motion-reduce:transition-none",
        "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2",
        "focus-visible:outline-border-focus",
        selected && "bg-surface-selected",
      )}
    >
      {/* Label, indented by containment. */}
      <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: row.depth * 12 }}>
        {row.hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={row.collapsed ? `Expand ${label}` : `Collapse ${label}`}
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className="shrink-0 rounded-xs text-fg-muted hover:opacity-80"
          >
            <Icon icon={row.collapsed ? CaretRight : CaretDown} size="xs" decorative />
          </button>
        ) : (
          <span aria-hidden="true" className="w-3 shrink-0" />
        )}

        {isGap ? (
          <Icon icon={WarningCircle} size="xs" decorative className="shrink-0 text-fg-muted" />
        ) : (
          <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tone!.solid)} />
        )}

        <span className={cn("truncate text-xs", isGap ? "italic text-fg-muted" : "text-fg-primary")}>
          {label}
        </span>

        {/*
          THE TEXT EQUIVALENT OF THE ROW'S TWO VISUAL-ONLY ENCODINGS.

          Status is a coloured dot and the critical path is a ring — both
          invisible to a screen reader and to anyone who cannot separate the
          hues. Rule 6: colour is never the only encoding. The row's readable
          name is its label and duration; these carry the rest.
        */}
        <span className="sr-only">
          {isGap
            ? ". Unaccounted: no span covers this time."
            /* A wait's status word adds nothing — its label already says the run
               was parked, and "Waiting for someone to approve. Succeeded." reads
               as though the approval itself were the outcome. */
            : isWait
              ? ". The run was parked, not working."
              : `. ${TONE[TONE_FOR_STATUS[span!.status]].label}.`}
          {row.onCriticalPath && " On the critical path."}
        </span>
        {row.collapsed && span && span.childCount > 0 && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-fg-muted">
            +{span.childCount}
          </span>
        )}
      </div>

      {/* The bar track. */}
      <div className="relative h-4">
        {bar && (
          <div
            aria-hidden="true"
            className={cn(
              "absolute h-4 rounded-xs",
              isGap
                ? /* Unaccounted: a DIFFERENT hatch from parked, in a neutral
                     tone, with a dashed edge. It is not a status the run
                     reached — it is us not knowing, and it must not be
                     mistakable for waiting. */
                  "border border-dashed border-border-strong bg-[repeating-linear-gradient(-45deg,var(--fg-disabled)_0,var(--fg-disabled)_1px,transparent_1px,transparent_6px)] opacity-70"
                : isWait
                  ? /* Parked. Hatched from the status token so it stays correct
                       in both themes. */
                    "border border-status-waiting-border bg-[repeating-linear-gradient(45deg,var(--status-waiting-subtle)_0,var(--status-waiting-subtle)_4px,transparent_4px,transparent_8px)]"
                  : cn(tone!.fill, "border", tone!.border),
              /* The critical path determined the total. Anything off it is
                 wasted optimisation effort. */
              row.onCriticalPath && "ring-1 ring-inset ring-fg-max",
            )}
            style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%` }}
          />
        )}
      </div>

      <span className={cn(
        "text-right font-mono text-xs tabular-nums",
        isGap ? "text-fg-muted" : "text-fg-secondary",
      )}>
        {formatDuration(durationMs)}
      </span>
    </div>
  );
}

// ── Tick seams ──────────────────────────────────────────────────────────────

function TickSeams({
  ticks, totalMs, zoom,
}: {
  ticks: Array<{ index: number; atMs: number; label: string }>;
  totalMs: number;
  zoom: readonly [number, number];
}) {
  /* One tick is not a seam — it is just the run. */
  if (ticks.length < 2 || totalMs <= 0) return null;
  const [z0, z1] = zoom;
  const zSpan = Math.max(1e-6, z1 - z0);

  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 px-2", GRID)}>
      <div />
      <div className="relative h-full">
        {ticks.map((t) => {
          const at = (t.atMs / totalMs - z0) / zSpan;
          if (at < 0 || at > 1) return null;
          return (
            <div
              key={t.index}
              className="absolute inset-y-0 border-l border-dashed border-border-subtle"
              style={{ left: `${at * 100}%` }}
            />
          );
        })}
      </div>
      <div />
    </div>
  );
}

// ── Header: axis, brush, filters ────────────────────────────────────────────

function Header({
  totalMs, spanCount, coverage: cov, zoom, onZoom, pathOnly, onPathOnly,
  hasCriticalPath, ticks,
}: {
  totalMs: number;
  spanCount: number;
  coverage: ReturnType<typeof coverage>;
  zoom: [number, number];
  onZoom: (z: [number, number]) => void;
  pathOnly: boolean;
  onPathOnly: (v: boolean) => void;
  hasCriticalPath: boolean;
  ticks: Array<{ index: number; atMs: number; label: string }>;
}) {
  const [z0, z1] = zoom;
  const zoomed = z0 > 0 || z1 < 1;
  const TICKS = 6;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Text variant="caption" className="text-fg-muted">
            {spanCount} rows · {formatDuration(totalMs)} total
          </Text>

          {/*
            UNACCOUNTED TIME IS ALWAYS REPORTED, even when it is too small to
            draw. Instrumentation gaps are a bug, and a bug that only shows up
            when it is already large is one that shipped.

            A known contributor: RunTracer drops gaps under a second as
            scheduling noise, so short queue waits land here rather than as
            `wait` bars. Saying so turns a mystery into a work item.
          */}
          {cov.unaccountedMs > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-xs border border-subtle px-1.5 py-0.5"
              title={
                `${formatDuration(cov.unaccountedMs)} of this run is covered by no span. ` +
                "Gaps under a second are not recorded as waits, so they appear here."
              }
            >
              <Icon icon={WarningCircle} size="xs" decorative className="text-fg-muted" />
              <Text variant="caption" className="text-fg-secondary">
                {formatDuration(cov.unaccountedMs)} unaccounted
              </Text>
              <span className="font-mono text-[10px] tabular-nums text-fg-muted">
                {Math.round((1 - cov.ratio) * 100)}%
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/*
            CRITICAL PATH ONLY. On a 2000-span trace this is the only view that
            fits, and it is the only one that answers "what determined the
            duration" — everything off the path could be made instant with no
            effect on the total.
          */}
          <label className={cn(
            "flex items-center gap-1.5 text-xs",
            hasCriticalPath ? "text-fg-secondary" : "cursor-not-allowed text-fg-disabled",
          )}>
            <input
              type="checkbox"
              checked={pathOnly}
              disabled={!hasCriticalPath}
              onChange={(e) => onPathOnly(e.target.checked)}
              className="accent-[color:var(--fg-link)]"
            />
            Critical path only
          </label>

          {zoomed && (
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
      </div>

      {/* The axis, on the same grid as the rows so the two cannot drift. */}
      <div className={cn("px-2", GRID)}>
        <div />
        <div className="relative h-6 border-b border-subtle">
          {Array.from({ length: TICKS + 1 }, (_, i) => {
            const frac = i / TICKS;
            /* Labelled with the ACTUAL time at that position, not the offset
               from the window start — zoomed in, the old version put "0s" at
               the left edge of a window that began 90 seconds into the run. */
            const atMs = totalMs * (z0 + frac * (z1 - z0));
            return (
              <span
                key={i}
                className={cn(
                  "absolute font-mono text-[10px] tabular-nums text-fg-muted",
                  i === 0 ? "left-0" : i === TICKS ? "right-0" : "-translate-x-1/2",
                )}
                style={i === 0 || i === TICKS ? undefined : { left: `${frac * 100}%` }}
              >
                {formatDuration(atMs)}
              </span>
            );
          })}

          {/* Tick seams labelled on the axis itself. */}
          {ticks.length > 1 && ticks.map((t) => {
            const at = (t.atMs / totalMs - z0) / Math.max(1e-6, z1 - z0);
            if (at < 0 || at > 1) return null;
            return (
              <span
                key={t.index}
                /* Sits on the baseline, below the time labels, so a tick at the
                   very start does not cover the "0s" it begins at. */
                className="absolute -bottom-0.5 -translate-x-1/2 rounded-xs border border-subtle bg-surface-sunken px-1 text-[9px] leading-tight text-fg-secondary"
                style={{ left: `${at * 100}%` }}
                title={`${t.label} started at ${formatDuration(t.atMs)}`}
              >
                {t.label}
              </span>
            );
          })}
        </div>
        <div />
      </div>

      {/*
        THE BRUSH.

        Two range inputs rather than a drag surface, because a canvas brush is
        keyboard-inoperable and this one is free.

        Each spans the FULL track. Side by side at half width each — which is
        what this was — the handles do not line up with the axis above them: the
        start handle could only ever reach the middle of the run, and the reader
        has to translate a position in the left half into a time in the whole.
        Stacked, a handle sits directly under the moment it selects.
      */}
      <div className={cn("px-2", GRID)}>
        <div />
        <div className="relative space-y-0.5">
          <div>
            <label className="sr-only" htmlFor="brush-start">Zoom window start</label>
            <input
              id="brush-start"
              type="range" min={0} max={0.99} step={0.01} value={z0}
              onChange={(e) => onZoom([Math.min(Number(e.target.value), z1 - 0.01), z1])}
              className="h-1 w-full accent-[color:var(--fg-link)]"
            />
          </div>
          <div>
            <label className="sr-only" htmlFor="brush-end">Zoom window end</label>
            <input
              id="brush-end"
              type="range" min={0.01} max={1} step={0.01} value={z1}
              onChange={(e) => onZoom([z0, Math.max(Number(e.target.value), z0 + 0.01)])}
              className="h-1 w-full accent-[color:var(--fg-link)]"
            />
          </div>
          {/* The selected window, drawn across both handles so the pair reads as
              one control rather than two sliders that happen to be adjacent. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 rounded-xs bg-fg-link/10 ring-1 ring-inset ring-fg-link/30"
            style={{ left: `${z0 * 100}%`, width: `${Math.max(0.5, (z1 - z0) * 100)}%` }}
          />
        </div>
        <div />
      </div>
    </div>
  );
}

// ── Hover summary ───────────────────────────────────────────────────────────

/**
 * Name, duration, self time, status. No payloads.
 *
 * Payloads load on demand and belong in the inspector: putting one behind a
 * hover would fetch on mouse-over, and a prompt is thousands of characters
 * rendered in a box nobody can scroll, select, or reach from a keyboard.
 *
 * One element for the whole list rather than a tooltip component per row —
 * 2000 rows means 2000 subscriptions, and this view is virtualised precisely to
 * avoid that kind of per-row cost.
 */
function HoverCard({
  hover,
}: {
  hover: { row: WaterfallRow; x: number; y: number };
}) {
  const { row, x, y } = hover;
  const span = row.span;

  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none fixed z-tooltip max-w-xs rounded-sm border border-subtle",
        "bg-surface-overlay px-2 py-1.5 shadow-2",
      )}
      /* Offset so the cursor never covers the card, and clamped to the viewport
         so a row at the right edge does not push it off-screen. */
      style={{
        left: Math.min(x + 12, (typeof window !== "undefined" ? window.innerWidth : 1024) - 280),
        top: y + 12,
      }}
    >
      {span == null ? (
        <>
          <Text variant="label" className="block text-fg-max">Unaccounted time</Text>
          <Text variant="caption" className="mt-0.5 block text-fg-secondary">
            {formatDuration(row.endMs - row.startMs)} of this run is covered by no
            span. Gaps under a second are not recorded as waits, so they surface
            here rather than as parked time.
          </Text>
        </>
      ) : (
        <>
          <Text variant="label" className="block truncate text-fg-max">
            {span.kind === "wait" ? waitReasonOf(span) : span.name}
          </Text>
          <div className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <Fact label="Kind" value={KIND_LABEL[span.kind] ?? span.kind} />
            <Fact label="Status" value={TONE[TONE_FOR_STATUS[span.status]].label} />
            <Fact label="Duration" value={formatDuration(span.durationMs)} mono />
            {/* Self time is the fact the bar cannot show: a 60s span that spent
                59s inside its children is not a slow span. */}
            <Fact label="Self" value={formatDuration(span.selfMs)} mono />
          </div>
          {row.onCriticalPath && (
            <Text variant="caption" className="mt-1 block text-fg-secondary">
              On the critical path — this span helped determine the total duration.
            </Text>
          )}
        </>
      )}
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <span className="text-[11px] text-fg-muted">{label}</span>
      <span className={cn("text-[11px] text-fg-primary", mono && "font-mono tabular-nums")}>
        {value}
      </span>
    </>
  );
}

// ── Legend ──────────────────────────────────────────────────────────────────

function Legend({ hasGaps }: { hasGaps: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2">
      {(["success", "failed", "waiting", "running", "skipped"] as const).map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE[t].solid)} />
          <span className="text-xs text-fg-muted">{TONE[t].label}</span>
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-2 w-4 rounded-xs border border-status-waiting-border bg-[repeating-linear-gradient(45deg,var(--status-waiting-subtle)_0,var(--status-waiting-subtle)_3px,transparent_3px,transparent_6px)]"
        />
        <span className="text-xs text-fg-muted">Parked (not running)</span>
      </span>
      {hasGaps && (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-4 rounded-xs border border-dashed border-border-strong bg-[repeating-linear-gradient(-45deg,var(--fg-disabled)_0,var(--fg-disabled)_1px,transparent_1px,transparent_6px)] opacity-70"
          />
          <span className="text-xs text-fg-muted">Unaccounted (no span)</span>
        </span>
      )}
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
