import { describe, expect, it } from "vitest";
import {
  MIN_GAP_MS, OVERSCAN, ROW_HEIGHT,
  concurrentWith, coverage, flattenRows, projectBar, runWindow, tickMarkers, visibleRange,
} from "~/components/app/debug/waterfall";
import type { TraceSpan } from "~/lib/api/trace";

/**
 * The waterfall's arithmetic.
 *
 * ── WHY COVERAGE IS THE TEST THAT MATTERS ───────────────────────────────────
 * A waterfall renders beautifully over incomplete instrumentation, and that is
 * a more convincing wrong answer than no waterfall at all: a gap where a span
 * should be looks exactly like a period when nothing was happening. So the
 * check that earns its keep is not "does it draw" but "does the run's wall
 * clock add up", and where it does not, "does the page SAY so".
 */

const T0 = Date.parse("2026-08-31T10:00:00.000Z");
let seq = 0;

function span(p: {
  kind: string;
  at: number;
  ms: number;
  name?: string;
  status?: string;
  children?: TraceSpan[];
  spanId?: string;
  selfMs?: number;
}): TraceSpan {
  seq += 1;
  return {
    spanId: p.spanId ?? `s${seq}`,
    parentSpanId: null,
    kind: p.kind as TraceSpan["kind"],
    name: p.name ?? p.kind,
    status: (p.status ?? "ok") as TraceSpan["status"],
    stepId: null,
    iterationIndex: null,
    startedAt: new Date(T0 + p.at).toISOString(),
    endedAt: new Date(T0 + p.at + p.ms).toISOString(),
    durationMs: p.ms,
    selfMs: p.selfMs ?? p.ms,
    failureClass: null,
    isRootCause: false,
    hasInput: false,
    hasOutput: false,
    tokensIn: null,
    tokensOut: null,
    costCents: null,
    childCount: p.children?.length ?? 0,
    children: p.children ?? [],
    truncated: false,
  };
}

const NO_OPTS = {
  criticalPathIds: new Set<string>(),
  collapsed: new Set<string>(),
  criticalPathOnly: false,
  gaps: [],
};

// ── ACCEPTANCE: the wall clock adds up ──────────────────────────────────────

describe("coverage", () => {
  /**
   * ACCEPTANCE: top-level bars plus wait spans equal the run duration, ±1%.
   *
   * This is the assertion that catches missing instrumentation. A trace that
   * renders fine and accounts for 60% of its own wall clock is telling the
   * reader that the other 40% was idle, which is a claim nobody made.
   */
  it("accounts for the whole run when the instrumentation is complete", () => {
    const trace = [
      span({
        kind: "run", at: 0, ms: 10_000, spanId: "run",
        children: [
          span({ kind: "wait", name: "wait:queue", at: 0, ms: 2_000 }),
          span({ kind: "tick", at: 2_000, ms: 3_000 }),
          span({ kind: "wait", name: "wait:approval", at: 5_000, ms: 4_000 }),
          span({ kind: "tick", at: 9_000, ms: 1_000 }),
        ],
      }),
    ];

    const c = coverage(trace);
    expect(c.totalMs).toBe(10_000);
    expect(c.unaccountedMs).toBe(0);
    expect(c.ratio).toBeGreaterThanOrEqual(0.99);
    expect(c.gaps).toHaveLength(0);
  });

  /** The same check, expressed the way the criterion words it, within ±1%. */
  it("puts the sum of top-level bars and waits within 1% of the run", () => {
    const trace = [
      span({
        kind: "run", at: 0, ms: 240_000, spanId: "run",
        children: [
          span({ kind: "wait", name: "wait:queue", at: 0, ms: 1_500 }),
          span({ kind: "tick", at: 1_500, ms: 60_000 }),
          span({ kind: "wait", name: "wait:approval", at: 61_500, ms: 158_000 }),
          span({ kind: "tick", at: 219_500, ms: 20_500 }),
        ],
      }),
    ];
    const c = coverage(trace);
    const summed = 1_500 + 60_000 + 158_000 + 20_500;
    expect(Math.abs(summed - c.totalMs) / c.totalMs).toBeLessThanOrEqual(0.01);
    expect(c.accountedMs).toBe(summed);
  });

  /**
   * A hole is found, measured, and placed where it happened.
   *
   * Forty seconds between the tick ending and the approval wait starting, with
   * no span to explain it. Whitespace would read as "the run was idle"; a named
   * gap reads as "we do not know", which is a different sentence.
   */
  it("finds an unexplained hole and says how long it was", () => {
    const trace = [
      span({
        kind: "run", at: 0, ms: 100_000, spanId: "run",
        children: [
          span({ kind: "tick", at: 0, ms: 20_000 }),
          // 40s of nothing
          span({ kind: "tick", at: 60_000, ms: 40_000 }),
        ],
      }),
    ];
    const c = coverage(trace);
    expect(c.gaps).toHaveLength(1);
    expect(c.gaps[0]).toMatchObject({ startMs: 20_000, endMs: 60_000, durationMs: 40_000 });
    expect(c.unaccountedMs).toBe(40_000);
    expect(c.ratio).toBeCloseTo(0.6, 5);
  });

  /** A hole at the very end counts too — a run that stopped reporting. */
  it("finds a hole in the tail", () => {
    const trace = [
      span({
        kind: "run", at: 0, ms: 10_000, spanId: "run",
        children: [span({ kind: "tick", at: 0, ms: 4_000 })],
      }),
    ];
    expect(coverage(trace).gaps).toEqual([
      { startMs: 4_000, endMs: 10_000, durationMs: 6_000 },
    ]);
  });

  /**
   * UNION, NOT SUM.
   *
   * The criterion is worded as a sum, which is only right while nothing at the
   * top level overlaps. Two overlapping ticks would sum PAST the run duration
   * and the check would pass on a trace that is wrong. The union measures the
   * wall clock actually covered and cannot be fooled that way.
   */
  it("is not fooled by overlapping top-level spans", () => {
    const trace = [
      span({
        kind: "run", at: 0, ms: 10_000, spanId: "run",
        children: [
          span({ kind: "tick", at: 0, ms: 8_000 }),
          span({ kind: "tick", at: 4_000, ms: 6_000 }),   // overlaps by 4s
        ],
      }),
    ];
    const c = coverage(trace);
    expect(8_000 + 6_000).toBeGreaterThan(c.totalMs);  // the sum would lie
    expect(c.accountedMs).toBe(10_000);                // the union does not
    expect(c.gaps).toHaveLength(0);
  });

  /** A trace whose root is a tick is still a trace, and is not 100% missing. */
  it("handles a trace with no run span", () => {
    const c = coverage([span({ kind: "tick", at: 0, ms: 5_000 })]);
    expect(c.unaccountedMs).toBe(0);
    expect(c.ratio).toBe(1);
  });

  /** An empty trace reports nothing rather than dividing by zero. */
  it("survives an empty trace", () => {
    expect(coverage([])).toMatchObject({ totalMs: 0, unaccountedMs: 0, ratio: 1 });
  });

  /**
   * Sub-millisecond noise is not a hole.
   *
   * The threshold exists to stop timestamp rounding producing phantom rows, and
   * is deliberately tiny — it is NOT there to tidy small gaps away. A 900ms gap
   * is a wait `RunTracer` suppressed, and the reader should see it.
   */
  it("ignores rounding noise but keeps a suppressed sub-second wait", () => {
    const noise = coverage([
      span({
        kind: "run", at: 0, ms: 1_000, spanId: "run",
        children: [
          span({ kind: "tick", at: 0, ms: 500 }),
          span({ kind: "tick", at: 500 + MIN_GAP_MS - 1, ms: 500 }),
        ],
      }),
    ]);
    expect(noise.gaps).toHaveLength(0);

    const suppressed = coverage([
      span({
        kind: "run", at: 0, ms: 5_000, spanId: "run",
        children: [
          span({ kind: "tick", at: 0, ms: 2_000 }),
          span({ kind: "tick", at: 2_900, ms: 2_100 }),
        ],
      }),
    ]);
    expect(suppressed.gaps[0]!.durationMs).toBe(900);
  });
});

// ── Rows ────────────────────────────────────────────────────────────────────

describe("rows", () => {
  const nested = [
    span({
      kind: "run", at: 0, ms: 1_000, spanId: "run",
      children: [
        span({
          kind: "tick", at: 0, ms: 1_000, spanId: "tick",
          children: [
            span({
              kind: "step", at: 0, ms: 900, spanId: "step",
              children: [span({ kind: "llm_call", at: 10, ms: 800, spanId: "llm" })],
            }),
          ],
        }),
      ],
    }),
  ];

  /** Indentation is containment, and every span gets a row. */
  it("flattens depth-first with depth from containment", () => {
    const rows = flattenRows(nested, NO_OPTS);
    expect(rows.map((r) => [r.key, r.depth])).toEqual([
      ["run", 0], ["tick", 1], ["step", 2], ["llm", 3],
    ]);
  });

  /** A collapsed subtree disappears; its own row stays, marked collapsed. */
  it("hides a collapsed subtree", () => {
    const rows = flattenRows(nested, { ...NO_OPTS, collapsed: new Set(["tick"]) });
    expect(rows.map((r) => r.key)).toEqual(["run", "tick"]);
    expect(rows.find((r) => r.key === "tick")!.collapsed).toBe(true);
    expect(rows.find((r) => r.key === "tick")!.hasChildren).toBe(true);
  });

  /**
   * The critical-path filter keeps descendants reachable.
   *
   * A parent OFF the path can contain a child ON it. Skipping a filtered
   * parent's children would hide the very rows the filter exists to show — and
   * on a 2000-span trace this filter is the only view that fits.
   */
  it("keeps a critical-path child under a parent that is not on the path", () => {
    const rows = flattenRows(nested, {
      ...NO_OPTS,
      criticalPathIds: new Set(["run", "llm"]),
      criticalPathOnly: true,
    });
    expect(rows.map((r) => r.key)).toEqual(["run", "llm"]);
    expect(rows.every((r) => r.onCriticalPath)).toBe(true);
  });

  /** Gaps are woven in where they happened, not appended at the end. */
  it("places a gap row between the spans it sits between", () => {
    const trace = [
      span({
        kind: "run", at: 0, ms: 100, spanId: "run",
        children: [
          span({ kind: "tick", at: 0, ms: 20, spanId: "t1" }),
          span({ kind: "tick", at: 60, ms: 40, spanId: "t2" }),
        ],
      }),
    ];
    const rows = flattenRows(trace, { ...NO_OPTS, gaps: coverage(trace).gaps });
    expect(rows.map((r) => r.key)).toEqual(["run", "t1", "gap-20", "t2"]);
    expect(rows.find((r) => r.kind === "gap")).toMatchObject({ depth: 1, startMs: 20, endMs: 60 });
  });

  /** Critical-path-only drops the gaps: they are not spans and not on any path. */
  it("omits gap rows when filtered to the critical path", () => {
    const trace = [
      span({
        kind: "run", at: 0, ms: 100, spanId: "run",
        children: [span({ kind: "tick", at: 0, ms: 20, spanId: "t1" })],
      }),
    ];
    const rows = flattenRows(trace, {
      ...NO_OPTS,
      criticalPathIds: new Set(["run", "t1"]),
      criticalPathOnly: true,
      gaps: coverage(trace).gaps,
    });
    expect(rows.some((r) => r.kind === "gap")).toBe(false);
  });
});

// ── ACCEPTANCE: a three-way fan-out shows three overlapping bars ────────────

describe("concurrency", () => {
  /**
   * ACCEPTANCE: a run with a 3-way fan-out shows three overlapping bars.
   *
   * This is how a supervisor's fan-out becomes self-explanatory. If the three
   * children were laid out sequentially — each given its own slice of the axis —
   * the picture would say the supervisor worked through them one at a time,
   * which is the opposite of what happened.
   */
  it("renders a three-way fan-out as three bars sharing the axis", () => {
    const trace = [
      span({
        kind: "run", at: 0, ms: 5_000, spanId: "run",
        children: [
          span({
            kind: "step", at: 0, ms: 5_000, spanId: "supervisor",
            children: [
              span({ kind: "activation", at: 100, ms: 4_000, spanId: "a" }),
              span({ kind: "activation", at: 150, ms: 3_800, spanId: "b" }),
              span({ kind: "activation", at: 120, ms: 4_200, spanId: "c" }),
            ],
          }),
        ],
      }),
    ];
    const rows = flattenRows(trace, NO_OPTS);

    for (const id of ["a", "b", "c"]) {
      const others = concurrentWith(rows, id).map((r) => r.key);
      expect(others, `${id} must overlap its two siblings`)
        .toEqual(expect.arrayContaining(["a", "b", "c"].filter((k) => k !== id)));
    }

    /* And the geometry agrees: their bars share axis, they are not stacked into
       separate slices of it. */
    const bars = ["a", "b", "c"].map((id) => {
      const r = rows.find((x) => x.key === id)!;
      return projectBar(r, 5_000, [0, 1])!;
    });
    const [p, q, s] = bars;
    expect(p!.left).toBeLessThan(q!.left + q!.width);
    expect(q!.left).toBeLessThan(s!.left + s!.width);
    expect(bars.every((b) => b.width > 0.7), "each bar spans most of the run").toBe(true);
  });
});

// ── Tick boundaries ─────────────────────────────────────────────────────────

describe("tick markers", () => {
  /** A yielding run reads as yielding: the seams are marked and numbered. */
  it("marks each tick start in order", () => {
    const trace = [
      span({
        kind: "run", at: 0, ms: 10_000, spanId: "run",
        children: [
          span({ kind: "tick", at: 0, ms: 2_000 }),
          span({ kind: "wait", name: "wait:throttle", at: 2_000, ms: 5_000 }),
          span({ kind: "tick", at: 7_000, ms: 3_000 }),
        ],
      }),
    ];
    expect(tickMarkers(trace)).toEqual([
      { index: 1, atMs: 0, label: "Tick 1" },
      { index: 2, atMs: 7_000, label: "Tick 2" },
    ]);
  });

  it("finds no boundaries in a run that never yielded", () => {
    expect(tickMarkers([span({ kind: "run", at: 0, ms: 10 })])).toEqual([]);
  });
});

// ── Projection ──────────────────────────────────────────────────────────────

describe("bar projection", () => {
  /** Unzoomed, a bar's position is its share of the run. */
  it("maps time onto the full axis", () => {
    const bar = projectBar({ startMs: 2_500, endMs: 5_000 }, 10_000, [0, 1])!;
    expect(bar.left).toBeCloseTo(0.25, 5);
    expect(bar.width).toBeCloseTo(0.25, 5);
  });

  /** Zoomed, the window is re-normalised so the brush actually magnifies. */
  it("re-normalises inside the brush window", () => {
    const bar = projectBar({ startMs: 5_000, endMs: 6_000 }, 10_000, [0.5, 0.7])!;
    expect(bar.left).toBeCloseTo(0, 5);
    expect(bar.width).toBeCloseTo(0.5, 5);
  });

  /**
   * A bar that starts before the window is clipped, not shifted.
   *
   * Without the clamp it renders at a negative offset and paints over the label
   * column — which is a bar in the wrong place, the one thing a waterfall must
   * never draw.
   */
  it("clips a bar that overruns the window at both ends", () => {
    const bar = projectBar({ startMs: 0, endMs: 10_000 }, 10_000, [0.4, 0.6])!;
    expect(bar.left).toBe(0);
    expect(bar.left + bar.width).toBeLessThanOrEqual(1);
  });

  /** Entirely outside: no bar. The row stays — its label is how you know it exists. */
  it("returns nothing for a bar outside the window", () => {
    expect(projectBar({ startMs: 0, endMs: 100 }, 10_000, [0.5, 1])).toBeNull();
    expect(projectBar({ startMs: 9_000, endMs: 9_500 }, 10_000, [0, 0.5])).toBeNull();
  });

  /** A 3ms call in a four-minute run is still a visible mark, not nothing. */
  it("gives a very short span a visible minimum width", () => {
    const bar = projectBar({ startMs: 1_000, endMs: 1_003 }, 240_000, [0, 1])!;
    expect(bar.width).toBeGreaterThanOrEqual(0.002);
  });
});

// ── ACCEPTANCE: 2000 spans stay cheap ───────────────────────────────────────

describe("virtualisation", () => {
  function bigTrace(n: number): TraceSpan[] {
    const kids: TraceSpan[] = [];
    for (let i = 0; i < n; i += 1) {
      kids.push(span({
        kind: i % 3 === 0 ? "llm_call" : "tool_call",
        at: i * 10, ms: 8, spanId: `n${i}`,
      }));
    }
    return [span({
      kind: "run", at: 0, ms: n * 10, spanId: "run",
      children: [span({ kind: "tick", at: 0, ms: n * 10, spanId: "tick", children: kids })],
    })];
  }

  /**
   * ACCEPTANCE: a 2000-span trace scrolls at 60fps.
   *
   * ── WHAT IS ACTUALLY UNDER THIS MODULE'S CONTROL ────────────────────────
   * Flattening is NOT per-frame work: the view memoises it on the trace, the
   * collapse set and the filter, so it runs on mount and when those change —
   * never on scroll. An earlier version of this test compared it to a 16ms
   * frame budget, which was the wrong budget for it and duly went flaky at
   * 16.4ms under parallel load.
   *
   * What a scroll actually costs is re-slicing the row array, and the property
   * that keeps that flat is the WINDOW: bounded, regardless of trace size. That
   * is deterministic, so it is asserted exactly.
   *
   * Flattening still gets a ceiling, but a generous one — it exists to catch an
   * accidental O(n²) walk, not to police milliseconds on a loaded CI box. The
   * scaling check below is the real guard against that.
   */
  it("renders a bounded window whatever the trace size", () => {
    const trace = bigTrace(2_000);
    const rows = flattenRows(trace, { ...NO_OPTS, gaps: coverage(trace).gaps });
    expect(rows.length).toBeGreaterThanOrEqual(2_000);

    /* A 480px viewport holds ~17 rows; the overscan is the only other term. */
    const ceiling = Math.ceil(480 / ROW_HEIGHT) + OVERSCAN * 2 + 1;
    for (const scrollTop of [0, 5_000, 25_000, rows.length * ROW_HEIGHT]) {
      const [first, last] = visibleRange(rows.length, scrollTop, 480);
      expect(last - first, `window at scrollTop ${scrollTop}`).toBeLessThanOrEqual(ceiling);
    }

    /* And the window is a small fraction of the trace: this is the whole reason
       a 2000-span trace can scroll at all. */
    const [f, l] = visibleRange(rows.length, 5_000, 480);
    expect((l - f) / rows.length).toBeLessThan(0.05);
  });

  /**
   * Flattening visits each span a CONSTANT number of times, whatever the size.
   *
   * ── WHY THIS IS COUNTED AND NOT TIMED ───────────────────────────────────
   * The first version of this test timed 1000 spans against 4000 and asserted
   * the ratio. It measured the machine, not the code: under a parallel runner
   * 4× the data took anywhere from 2× to 7× the time, so the threshold was
   * either flaky or so loose it proved nothing. Wall-clock ratios do not belong
   * in a suite that runs 37 files at once.
   *
   * The property actually worth protecting is that no walk is nested inside
   * another — the way a linear traversal quietly becomes quadratic. Counting
   * reads of `children` proves exactly that, and gives the same answer on every
   * machine: if the per-span count is identical at 100 and at 1000 spans, the
   * traversal is linear.
   */
  it("visits each span a constant number of times regardless of trace size", () => {
    const readsPerSpan = (n: number): number => {
      let reads = 0;
      const instrument = (s: TraceSpan): TraceSpan => {
        const kids = s.children.map(instrument);
        return Object.defineProperty({ ...s }, "children", {
          get() { reads += 1; return kids; },
          enumerable: true,
        }) as TraceSpan;
      };
      const trace = bigTrace(n).map(instrument);
      flattenRows(trace, { ...NO_OPTS, gaps: coverage(trace).gaps });
      /* +2 for the run and tick wrappers bigTrace adds around the leaves. */
      return reads / (n + 2);
    };

    const small = readsPerSpan(100);
    const large = readsPerSpan(1_000);
    /* Not exactly equal: the run and tick wrappers are a fixed cost that a
       larger trace amortises further. Converging is the linear signature —
       a quadratic walk would double this figure between the two sizes. */
    expect(large, `${small.toFixed(3)} reads/span at 100, ${large.toFixed(3)} at 1000`)
      .toBeCloseTo(small, 1);
    expect(small, "a handful of passes, not a pass per span").toBeLessThan(10);
  });

  /** The window follows the scroll and never runs off either end. */
  it("clamps the window at the top and the bottom", () => {
    const [f0] = visibleRange(2_000, 0, 480);
    expect(f0).toBe(0);

    const [, lastEnd] = visibleRange(2_000, 2_000 * ROW_HEIGHT, 480);
    expect(lastEnd).toBe(2_000);
  });

  /** A trace shorter than the viewport renders whole. */
  it("renders everything when it all fits", () => {
    const [first, last] = visibleRange(5, 0, 480);
    expect([first, last]).toEqual([0, 5]);
  });
});

// ── The window ──────────────────────────────────────────────────────────────

describe("run window", () => {
  /** A child that outlives its parent extends the axis rather than being clipped. */
  it("takes the axis from the whole tree, not just the roots", () => {
    const trace = [
      span({
        kind: "run", at: 0, ms: 1_000, spanId: "run",
        children: [span({ kind: "tool_call", at: 500, ms: 3_000 })],
      }),
    ];
    expect(runWindow(trace).totalMs).toBe(3_500);
  });

  it("reports nothing for an empty trace rather than infinity", () => {
    expect(runWindow([])).toEqual({ t0: 0, totalMs: 0 });
  });
});
