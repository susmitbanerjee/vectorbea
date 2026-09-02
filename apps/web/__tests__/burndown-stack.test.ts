import { describe, expect, it } from "vitest";
import { stackBands } from "~/components/app/debug/cost-view";
import type { BurndownBand } from "~/lib/api/constellation";

/**
 * Stacking the bands.
 *
 * ── THE MISTAKE THIS EXISTS TO PREVENT ──────────────────────────────────────
 * Each band has its own sample times: an agent that made three calls has three
 * points, one that made thirty has thirty. Stacking those index by index puts
 * band B's second point on top of band A's second point regardless of WHEN
 * either happened — which draws a smooth, plausible chart of a run that never
 * occurred.
 *
 * Every band is therefore evaluated at every timestamp in the run, carrying its
 * last known value forward. That is what makes the stack's height at a moment
 * the real total at that moment.
 */

function band(p: Partial<BurndownBand> & {
  agentName: string;
  points: Array<[number, number]>;   // [atMs, cumulative cost]
}): BurndownBand {
  return {
    activationId: p.activationId ?? p.agentName,
    agentName: p.agentName,
    role: p.role ?? "worker",
    depth: p.depth ?? 0,
    tokens: p.tokens ?? 0,
    costCents: p.points[p.points.length - 1]?.[1] ?? 0,
    iterations: p.iterations ?? 0,
    shareOfCost: p.shareOfCost ?? 0,
    points: p.points.map(([atMs, costCents]) => ({
      atMs, costCents, tokens: costCents * 100, iterations: 1,
    })),
  };
}

/**
 * The y of every vertex on an area's TOP edge, in draw order.
 *
 * The path is `M <top…> L <bottom reversed…> Z`, so the first half is the top
 * edge and the second half is the floor it sits on. Reading all of them mixes
 * the two and makes every band look like it has two heights.
 */
function topEdge(d: string): number[] {
  const body = d.replace(/^M /, "").replace(/ Z$/, "");
  const ys = body.split(" L ").map((pt) => Number(pt.split(",")[1]));
  return ys.slice(0, ys.length / 2);
}

describe("stacking", () => {
  /**
   * Bands sampled at different times still stack by TIME.
   *
   * A stacks at 0ms and 900ms; B only at 500ms. At 900ms the true total is
   * A(10) + B(4) = 14, because B's value carries forward — not A(10) alone.
   */
  it("carries each band forward to every timestamp in the run", () => {
    const bands = [
      band({ agentName: "a", points: [[0, 6], [900, 10]] }),
      band({ agentName: "b", points: [[500, 4]] }),
    ];
    const { areas, total } = stackBands(bands, "cost", 900);

    expect(areas).toHaveLength(2);
    /* The stack's peak is the real total at the last moment, not the sum of
       whatever each band happened to report last at its own times. */
    expect(total).toBe(14);
  });

  /** The lower band's top edge IS the upper band's floor — no gaps, no overlap. */
  it("sits each band exactly on the one below it", () => {
    const bands = [
      band({ agentName: "a", points: [[0, 5], [1_000, 5]] }),
      band({ agentName: "b", points: [[0, 5], [1_000, 5]] }),
    ];
    const { areas, total } = stackBands(bands, "cost", 1_000);
    expect(total).toBe(10);

    /* Band A's top is at 5 of 10 — the vertical midpoint. Band B's top is at
       10 of 10 — the ceiling of the plot area. */
    const aTop = topEdge(areas[0]!.d);
    const bTop = topEdge(areas[1]!.d);
    expect(new Set(aTop).size).toBe(1);
    expect(new Set(bTop).size).toBe(1);
    expect(bTop[0]!).toBeLessThan(aTop[0]!);   // higher on screen = smaller y
  });

  /**
   * ACCEPTANCE: the sum of the bands is the run's total.
   *
   * Asserted on the GEOMETRY as well as the numbers: a chart whose figures add
   * up and whose areas do not is the failure this test is for.
   */
  it("draws a stack whose height is the sum of its bands", () => {
    const bands = [
      band({ agentName: "supervisor", points: [[0, 4.25]] }),
      band({ agentName: "researcher", points: [[1_000, 18.5], [2_000, 26.75]] }),
    ];
    const { total } = stackBands(bands, "cost", 2_000);
    expect(total).toBe(4.25 + 26.75);
    expect(total).toBe(31);
  });

  /** Each measure stacks on its own numbers. */
  it("stacks tokens and iterations independently of cost", () => {
    const bands = [band({ agentName: "a", points: [[0, 3], [1_000, 7]] })];
    expect(stackBands(bands, "cost", 1_000).total).toBe(7);
    expect(stackBands(bands, "tokens", 1_000).total).toBe(700);
    expect(stackBands(bands, "iterations", 1_000).total).toBe(1);
  });

  /** A single band is a valid stack — a single-agent run still has an answer. */
  it("stacks one band", () => {
    const { areas, total } = stackBands(
      [band({ agentName: "solo", points: [[0, 12], [900, 31]] })], "cost", 900);
    expect(areas).toHaveLength(1);
    expect(total).toBe(31);
    expect(areas[0]!.d).toMatch(/^M .* Z$/);
  });

  /** Nothing metered draws nothing, rather than a degenerate path. */
  it("draws no areas for an empty run", () => {
    expect(stackBands([], "cost", 0)).toEqual({ areas: [], total: 0 });
    expect(stackBands([band({ agentName: "a", points: [] })], "cost", 0))
      .toEqual({ areas: [], total: 0 });
  });

  /**
   * A zero-duration run does not divide by zero.
   *
   * Two spans in the same millisecond is a real trace, and it must draw
   * something rather than NaN its way through the path data.
   */
  it("survives a run with no elapsed time", () => {
    const { areas } = stackBands(
      [band({ agentName: "a", points: [[0, 5]] })], "cost", 0);
    expect(areas[0]!.d).not.toMatch(/NaN/);
  });

  /** Every path is closed, so an area never renders as an open polyline. */
  it("closes every path", () => {
    const bands = [
      band({ agentName: "a", points: [[0, 1], [500, 2]] }),
      band({ agentName: "b", points: [[250, 3]] }),
    ];
    for (const a of stackBands(bands, "cost", 500).areas) {
      expect(a.d.endsWith(" Z")).toBe(true);
      expect(a.d).not.toMatch(/NaN|Infinity/);
    }
  });
});

// ── The axis scale ──────────────────────────────────────────────────────────

describe("axis scale", () => {
  /**
   * The bands and the axis share ONE maximum.
   *
   * They did not: `stackBands` computed its own peak from the bands while the
   * caller drew the grid and the ceiling lines against the highest ceiling. A
   * run that spent 36¢ of a $1.00 ceiling therefore drew a stack filling the
   * whole plot, with the ceiling line floating near the top — "40 of its 100"
   * rendered as a full chart, which is the one thing a ceiling exists to
   * prevent. Caught by looking at it.
   */
  it("draws well under the line when the run stayed well under it", () => {
    const bands = [band({ agentName: "a", points: [[0, 18], [1_000, 36]] })];

    const unscaled = stackBands(bands, "cost", 1_000);
    const scaled = stackBands(bands, "cost", 1_000, 100);

    /* The reported total is the run's, whatever the axis. */
    expect(unscaled.total).toBe(36);
    expect(scaled.total).toBe(36);

    /* But the geometry differs: against a 100 scale the stack tops out around a
       third of the way up, not at the ceiling of the plot. */
    const topUnscaled = Math.min(...topEdge(unscaled.areas[0]!.d));
    const topScaled = Math.min(...topEdge(scaled.areas[0]!.d));
    expect(topScaled).toBeGreaterThan(topUnscaled);
  });

  /** With no ceiling the stack uses its own peak, so a chart is never empty. */
  it("falls back to the stack's own peak", () => {
    const bands = [band({ agentName: "a", points: [[0, 10]] })];
    const a = stackBands(bands, "cost", 1_000);
    const b = stackBands(bands, "cost", 1_000, 0);
    expect(topEdge(a.areas[0]!.d)).toEqual(topEdge(b.areas[0]!.d));
  });
});
