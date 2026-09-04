import type { TraceSpan } from "~/lib/api/trace";

/**
 * The waterfall's arithmetic: what goes on which row, at which time, and what
 * is MISSING.
 *
 * ── WHY THIS IS PURE AND SEPARATE FROM THE VIEW ─────────────────────────────
 * Two of the three things this file does are claims about the data, not about
 * pixels: whether the run's wall clock is fully accounted for, and where the
 * holes are. Those are assertable, and they are the ones worth asserting —
 * a waterfall that renders beautifully over incomplete instrumentation is a
 * more convincing wrong answer than no waterfall at all.
 */

/** Rows the waterfall knows how to draw. */
export type RowKind = "span" | "gap";

export interface WaterfallRow {
  key: string;
  kind: RowKind;
  depth: number;
  /** Milliseconds from the start of the run. */
  startMs: number;
  endMs: number;
  span: TraceSpan | null;
  onCriticalPath: boolean;
  hasChildren: boolean;
  collapsed: boolean;
  /** 1-based tick number, on tick rows only, for the boundary markers. */
  tickIndex: number | null;
}

export interface RunWindow {
  /** Epoch ms of the earliest span. Every row's `startMs` is relative to this. */
  t0: number;
  totalMs: number;
}

// ── The time window ─────────────────────────────────────────────────────────

function startOf(s: TraceSpan): number {
  return Date.parse(s.startedAt);
}

function endOf(s: TraceSpan): number {
  const start = startOf(s);
  if (s.endedAt) {
    const e = Date.parse(s.endedAt);
    if (Number.isFinite(e)) return e;
  }
  return start + (s.durationMs ?? 0);
}

/**
 * The axis: earliest start to latest end, across the whole tree.
 *
 * Taken from the DESCENDANTS as well as the roots, because a child that
 * outlives its parent is a real shape — a fire-and-forget span, or a parent
 * whose end timestamp was written before its last child's — and clipping the
 * axis to the root would silently truncate it.
 */
export function runWindow(spans: TraceSpan[]): RunWindow {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const walk = (list: TraceSpan[]) =>
    list.forEach((s) => {
      const a = startOf(s);
      if (Number.isFinite(a)) {
        min = Math.min(min, a);
        max = Math.max(max, endOf(s));
      }
      walk(s.children);
    });
  walk(spans);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { t0: 0, totalMs: 0 };
  return { t0: min, totalMs: Math.max(0, max - min) };
}

// ── Coverage: what the run's wall clock is NOT accounted for by ─────────────

export interface Gap {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface Coverage {
  totalMs: number;
  accountedMs: number;
  unaccountedMs: number;
  /** Every hole, in order, so each can be drawn where it happened. */
  gaps: Gap[];
  /** accountedMs / totalMs, 1 when there is nothing to account for. */
  ratio: number;
}

/**
 * How much of the run's wall clock is explained by a span, and what is not.
 *
 * ── WHY UNION AND NOT SUM ───────────────────────────────────────────────────
 * The acceptance criterion is written as "sum of top-level bars plus wait spans
 * equals total run duration". Summing is only right while nothing at the top
 * level overlaps — and if two ticks ever DID overlap, the sum would exceed the
 * run duration and the check would pass while the trace was wrong. The union
 * cannot be fooled that way: it measures the wall clock actually covered, which
 * is the thing the criterion is really asking about.
 *
 * ── WHY THE HOLES ARE THE POINT ─────────────────────────────────────────────
 * Unaccounted time is a bug in the instrumentation. Rendered as whitespace it
 * stays a bug forever, because a gap in a waterfall reads as "nothing was
 * happening" — which is exactly what a missing span looks like. Named, it reads
 * as "we do not know what was happening", which is a different sentence and
 * gets fixed.
 *
 * A known contributor: `RunTracer.emitWait` drops gaps under one second as
 * scheduling noise, so several short queue waits surface here rather than as
 * `wait` bars. That is worth seeing.
 */
export function coverage(spans: TraceSpan[]): Coverage {
  const { t0, totalMs } = runWindow(spans);
  if (totalMs <= 0) {
    return { totalMs: 0, accountedMs: 0, unaccountedMs: 0, gaps: [], ratio: 1 };
  }

  /*
   * The top level is the run's own children when there is a run span, and the
   * roots themselves when there is not — a trace whose root is a tick is still
   * a trace, and it must not report 100% unaccounted.
   */
  const run = spans.find((s) => s.kind === "run");
  const top = run ? run.children : spans;

  const intervals = top
    .map((s) => [startOf(s) - t0, endOf(s) - t0] as const)
    .filter(([a, b]) => Number.isFinite(a) && b > a)
    .sort((x, y) => x[0] - y[0]);

  /* Merge overlaps, then walk the merged list to find what is between. */
  const merged: Array<[number, number]> = [];
  for (const [a, b] of intervals) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }

  const gaps: Gap[] = [];
  let cursor = 0;
  for (const [a, b] of merged) {
    if (a - cursor >= MIN_GAP_MS) {
      gaps.push({ startMs: cursor, endMs: a, durationMs: a - cursor });
    }
    cursor = Math.max(cursor, b);
  }
  if (totalMs - cursor >= MIN_GAP_MS) {
    gaps.push({ startMs: cursor, endMs: totalMs, durationMs: totalMs - cursor });
  }

  const accountedMs = merged.reduce((n, [a, b]) => n + (b - a), 0);
  return {
    totalMs,
    accountedMs,
    unaccountedMs: Math.max(0, totalMs - accountedMs),
    gaps,
    ratio: accountedMs / totalMs,
  };
}

/**
 * Below this a gap is float noise, not a hole.
 *
 * One millisecond, deliberately tiny: the threshold exists to stop timestamp
 * rounding producing phantom rows, NOT to tidy small holes away. A 900ms gap in
 * a four-minute run is a suppressed wait span and the reader should see it.
 */
export const MIN_GAP_MS = 1;

// ── Rows ────────────────────────────────────────────────────────────────────

export interface FlattenOptions {
  criticalPathIds: ReadonlySet<string>;
  /** Span ids whose subtrees are hidden. */
  collapsed: ReadonlySet<string>;
  /**
   * Only spans on the critical path.
   *
   * On a 2000-span trace this is the only view that fits, and it is also the
   * only one that answers "what actually determined the duration" — everything
   * off the path could be made instant with no effect on the total.
   */
  criticalPathOnly: boolean;
  /** Unaccounted gaps to interleave, from [coverage]. */
  gaps: Gap[];
}

/**
 * Depth-first rows, with the unaccounted gaps woven in where they happened.
 *
 * Gaps sit at depth 1 — as siblings of the ticks and waits they sit between —
 * because that is where the hole is, and floating them to the end of the list
 * would put "we lost 40 seconds somewhere" next to the last tool call rather
 * than next to the silence it describes.
 */
export function flattenRows(spans: TraceSpan[], opts: FlattenOptions): WaterfallRow[] {
  const { t0 } = runWindow(spans);
  const rows: WaterfallRow[] = [];
  let tickCount = 0;

  const push = (s: TraceSpan, depth: number) => {
    const onPath = opts.criticalPathIds.has(s.spanId);
    if (opts.criticalPathOnly && !onPath) return false;

    if (s.kind === "tick") tickCount += 1;
    rows.push({
      key: s.spanId,
      kind: "span",
      depth,
      startMs: startOf(s) - t0,
      endMs: endOf(s) - t0,
      span: s,
      onCriticalPath: onPath,
      hasChildren: s.children.length > 0,
      collapsed: opts.collapsed.has(s.spanId),
      tickIndex: s.kind === "tick" ? tickCount : null,
    });
    return true;
  };

  const walk = (list: TraceSpan[], depth: number) => {
    for (const s of list) {
      const shown = push(s, depth);
      /*
       * A collapsed subtree is hidden but a FILTERED one is not: in
       * critical-path-only mode a parent off the path can still contain a child
       * on it, and skipping its children would hide the very rows the filter
       * exists to show.
       */
      if (shown && opts.collapsed.has(s.spanId)) continue;
      walk(s.children, shown ? depth + 1 : depth);
    }
  };
  walk(spans, 0);

  if (opts.criticalPathOnly) return rows;

  /* Gaps interleave by start time among the top-level rows. */
  const gapRows: WaterfallRow[] = opts.gaps.map((g) => ({
    key: `gap-${g.startMs}`,
    kind: "gap",
    depth: 1,
    startMs: g.startMs,
    endMs: g.endMs,
    span: null,
    onCriticalPath: false,
    hasChildren: false,
    collapsed: false,
    tickIndex: null,
  }));
  if (gapRows.length === 0) return rows;

  /* Insert each gap before the first row that starts after it. Stable, and it
     keeps the depth-first order of everything else intact. */
  const out: WaterfallRow[] = [];
  let gi = 0;
  for (const r of rows) {
    while (gi < gapRows.length && gapRows[gi]!.startMs < r.startMs) {
      out.push(gapRows[gi]!);
      gi += 1;
    }
    out.push(r);
  }
  while (gi < gapRows.length) { out.push(gapRows[gi]!); gi += 1; }
  return out;
}

// ── Tick boundaries ─────────────────────────────────────────────────────────

export interface TickMarker {
  index: number;
  atMs: number;
  label: string;
}

/**
 * Where each tick began.
 *
 * A run that yielded and resumed is one run made of several ticks, with a gap
 * between them that is not a hang. Without the boundaries the reader sees one
 * long bar with holes in it; with them, the holes are obviously the seams.
 */
export function tickMarkers(spans: TraceSpan[]): TickMarker[] {
  const { t0 } = runWindow(spans);
  const ticks: TraceSpan[] = [];
  const walk = (list: TraceSpan[]) =>
    list.forEach((s) => { if (s.kind === "tick") ticks.push(s); walk(s.children); });
  walk(spans);

  return ticks
    .sort((a, b) => startOf(a) - startOf(b))
    .map((s, i) => ({ index: i + 1, atMs: startOf(s) - t0, label: `Tick ${i + 1}` }));
}

// ── Concurrency ─────────────────────────────────────────────────────────────

/**
 * How many rows overlap this one in time.
 *
 * Used only to prove the view is honest about parallelism: a supervisor's
 * three-way fan-out must render as three bars that share the same stretch of
 * axis, not as three stacked bars that happen to look sequential because each
 * was given its own slice.
 */
export function concurrentWith(rows: WaterfallRow[], key: string): WaterfallRow[] {
  const target = rows.find((r) => r.key === key);
  if (!target) return [];
  return rows.filter(
    (r) => r.key !== key && r.startMs < target.endMs && target.startMs < r.endMs,
  );
}

// ── Virtualisation ──────────────────────────────────────────────────────────

export const ROW_HEIGHT = 28;
/** Rows kept beyond the viewport, so a fast scroll never shows a blank strip. */
export const OVERSCAN = 12;

/**
 * The slice of rows to put in the DOM.
 *
 * A 2000-span trace is 2000 absolutely-positioned nodes, several with a
 * generated hatch background. Rendering all of them costs a long frame on mount
 * and another on every zoom, which is exactly the interaction this view is for.
 */
export function visibleRange(
  count: number, scrollTop: number, viewportH: number,
): [number, number] {
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(count, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + OVERSCAN);
  return [first, Math.max(first, last)];
}

// ── Projection onto the zoom window ─────────────────────────────────────────

/**
 * A row's bar in the current brush window, as fractions of the visible axis.
 *
 * Returns null when the row is entirely outside the window — the ROW still
 * renders (its label is how you know it exists) but the bar does not, and
 * clipping here keeps a long bar from painting over the duration column.
 */
export function projectBar(
  row: { startMs: number; endMs: number },
  totalMs: number,
  zoom: readonly [number, number],
): { left: number; width: number } | null {
  if (totalMs <= 0) return null;
  const [z0, z1] = zoom;
  const zSpan = Math.max(1e-6, z1 - z0);
  const a = (row.startMs / totalMs - z0) / zSpan;
  const b = (row.endMs / totalMs - z0) / zSpan;
  if (b < 0 || a > 1) return null;

  const left = Math.max(0, a);
  const right = Math.min(1, b);
  return {
    left,
    /* A floor of 0.2% so a 3ms call is still a visible mark: a bar nobody can
       see is a span nobody knows ran. Clamped so the floor cannot push it out
       of the track. */
    width: Math.min(1 - left, Math.max(0.002, right - left)),
  };
}
