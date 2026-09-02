import { describe, expect, it } from "vitest";
import {
  MAX_NODE_W, MIN_NODE_W, VIRTUALISE_ABOVE,
  assignColumns, layoutFlow, visibleNodes,
} from "~/components/app/debug/flow-layout";
import { scaleWidth } from "~/components/app/debug/primitives";
import type { GraphEdge, GraphNode } from "~/lib/api/trace";

/**
 * The Flow view's geometry, which is where this kind of view goes wrong in ways
 * a screenshot of one healthy run never shows.
 *
 * ── WHAT SHIPPED BEFORE ─────────────────────────────────────────────────────
 * A wrapped grid of same-sized cards labelled by node type, with no edges. Every
 * fault in that list is a geometry fault:
 *
 *   - EQUAL CARDS meant duration was readable only as a monospace number, which
 *     makes "where did the time go" the slowest question to answer on the page
 *     built to answer it.
 *   - WRAPPING asserted an order that was an artefact of the viewport width, so
 *     resizing the window appeared to change the workflow.
 *   - NO EDGES meant the structure — the reason to draw a graph at all — was
 *     absent.
 */

function node(p: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    id: p.id, label: p.label ?? p.id, type: p.type ?? "http",
    status: p.status ?? "ok", reached: p.reached ?? true,
    attempts: p.attempts ?? 1, totalMs: p.totalMs ?? 100,
    spanIds: p.spanIds ?? [`span-${p.id}`], warnings: p.warnings ?? [],
    isRootCause: p.isRootCause ?? false, costCents: null,
    tokensIn: null, tokensOut: null, summary: p.summary ?? null,
  };
}

function edge(id: string, source: string, target: string, traversed: boolean | null = true): GraphEdge {
  return { id, source, target, type: "default", label: null, condition: null, traversed };
}

// ── Structure ───────────────────────────────────────────────────────────────

describe("column assignment", () => {
  /**
   * LONGEST path, not shortest.
   *
   * With shortest paths a node reachable both in one hop and at the end of a
   * five-hop chain lands in column 1, and the five-hop edge then renders
   * right-to-left — which reads as a loop the workflow does not have.
   */
  it("places a node after every one of its predecessors", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => node({ id }));
    const edges = [
      edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "d"),
      edge("e4", "a", "d"),   // the shortcut
    ];
    const col = assignColumns(nodes, edges);
    expect(col.get("d")).toBe(3);
    expect(col.get("d")!).toBeGreaterThan(col.get("c")!);
  });

  /** A branch puts both arms in the same column, side by side. */
  it("puts sibling branches in one column", () => {
    const nodes = ["root", "yes", "no"].map((id) => node({ id }));
    const col = assignColumns(nodes, [edge("e1", "root", "yes"), edge("e2", "root", "no")]);
    expect(col.get("yes")).toBe(1);
    expect(col.get("no")).toBe(1);
  });

  /**
   * A cycle settles rather than hanging.
   *
   * Workflows can loop — an agent that hands back to its supervisor is the
   * common case — and a layout that recurses forever takes the whole tab down.
   */
  it("terminates on a cycle", () => {
    const nodes = ["a", "b", "c"].map((id) => node({ id }));
    const col = assignColumns(nodes, [
      edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a"),
    ]);
    expect(col.size).toBe(3);
    expect([...col.values()].every((v) => Number.isFinite(v))).toBe(true);
  });
});

// ── Duration as width ───────────────────────────────────────────────────────

describe("width encodes duration", () => {
  /**
   * ACCEPTANCE: a failed run's failing step is findable without reading any
   * duration text — which requires the widths to actually differ.
   */
  it("gives a slow node a visibly wider card than a fast one", () => {
    const layout = layoutFlow(
      [node({ id: "fast", totalMs: 1 }), node({ id: "slow", totalMs: 65_000 })],
      [edge("e", "fast", "slow")],
    );
    const fast = layout.nodes.find((p) => p.node.id === "fast")!;
    const slow = layout.nodes.find((p) => p.node.id === "slow")!;
    expect(slow.w).toBeGreaterThan(fast.w * 2);
    expect(fast.w).toBe(MIN_NODE_W);
  });

  /**
   * A 1ms node stays clickable.
   *
   * Strict proportionality would draw it 0.2px wide. This is a card, not a
   * waterfall bar — the TIMELINE is where exact proportion lives.
   */
  it("never draws a node below the clickable minimum", () => {
    const layout = layoutFlow(
      [node({ id: "tiny", totalMs: 1 }), node({ id: "huge", totalMs: 600_000 })],
      [],
    );
    expect(layout.nodes.every((p) => p.w >= MIN_NODE_W)).toBe(true);
  });

  /** The ceiling holds: nothing is ever drawn wider than the maximum. */
  it("never exceeds the ceiling", () => {
    expect(scaleWidth(600_000, 600_000, MIN_NODE_W, MAX_NODE_W)).toBeLessThanOrEqual(MAX_NODE_W);
    expect(scaleWidth(9_000_000, 600_000, MIN_NODE_W, MAX_NODE_W)).toBeLessThanOrEqual(MAX_NODE_W);
  });

  /**
   * A node that dwarfs the rest is MARKED, because its width understates it.
   *
   * The first version of this flag tested whether the computed width exceeded
   * the ceiling — which can never happen, since the slowest node IS the ceiling.
   * A flag that cannot fire is worse than no flag: it reads as a guarantee that
   * nothing is being compressed. What actually compresses is the square root,
   * and the case worth marking is one node dominating the others.
   */
  it("marks a dominating node, and leaves an ordinary spread unmarked", () => {
    const dominated = layoutFlow([
      node({ id: "slow", totalMs: 600_000 }),
      node({ id: "a", totalMs: 900 }),
      node({ id: "b", totalMs: 400 }),
    ], []);
    expect(dominated.nodes.find((p) => p.node.id === "slow")!.clamped).toBe(true);
    expect(dominated.nodes.find((p) => p.node.id === "a")!.clamped).toBe(false);

    const even = layoutFlow([
      node({ id: "x", totalMs: 1_000 }),
      node({ id: "y", totalMs: 800 }),
      node({ id: "z", totalMs: 600 }),
    ], []);
    expect(even.nodes.every((p) => !p.clamped),
      "an ordinary spread has nothing to warn about").toBe(true);
  });

  /** A single node has nothing to dominate, so it is never marked. */
  it("does not mark the only node in a run", () => {
    const layout = layoutFlow([node({ id: "only", totalMs: 600_000 })], []);
    expect(layout.nodes[0]!.clamped).toBe(false);
  });

  /**
   * The square root is the point: linear against the slowest node collapses
   * everything else onto the floor, and they are all the same size again.
   */
  it("keeps fast nodes separable next to a very slow one", () => {
    const a = scaleWidth(3, 600_000, MIN_NODE_W, MAX_NODE_W);
    const b = scaleWidth(400, 600_000, MIN_NODE_W, MAX_NODE_W);
    expect(b).toBeGreaterThan(a);
  });

  /** A node that never ran encodes no duration — the floor, not a zero-width sliver. */
  it("gives an unreached node the minimum width and no claim about time", () => {
    const layout = layoutFlow(
      [node({ id: "ran", totalMs: 9_000 }), node({ id: "never", reached: false, totalMs: null })],
      [],
    );
    const never = layout.nodes.find((p) => p.node.id === "never")!;
    expect(never.w).toBe(MIN_NODE_W);
    expect(never.clamped).toBe(false);
  });
});

// ── No overlap ──────────────────────────────────────────────────────────────

describe("layout", () => {
  /**
   * ACCEPTANCE: narrow viewport — the graph scrolls and nothing overlaps.
   *
   * Overlap is the failure mode of a variable-width layout, and it only appears
   * when one column happens to hold a wide node, which is exactly the case a
   * screenshot of a simple run does not contain.
   */
  it("never overlaps two nodes, even when widths vary wildly", () => {
    const nodes = [
      node({ id: "a", totalMs: 1 }),
      node({ id: "b", totalMs: 300_000 }),
      node({ id: "c", totalMs: 40 }),
      node({ id: "d", totalMs: 8_000 }),
      node({ id: "e", totalMs: 2 }),
    ];
    const edges = [
      edge("e1", "a", "b"), edge("e2", "b", "c"),
      edge("e3", "b", "d"), edge("e4", "c", "e"), edge("e5", "d", "e"),
    ];
    const layout = layoutFlow(nodes, edges);

    for (const p of layout.nodes) {
      for (const q of layout.nodes) {
        if (p === q) continue;
        const overlapX = p.x < q.x + q.w && q.x < p.x + p.w;
        const overlapY = p.y < q.y + q.h && q.y < p.y + p.h;
        expect(overlapX && overlapY,
          `${p.node.id} overlaps ${q.node.id}`).toBe(false);
      }
    }
  });

  /** Every node sits inside the reported canvas, so nothing is clipped. */
  it("reports a canvas that contains everything it placed", () => {
    const nodes = ["a", "b", "c"].map((id, i) => node({ id, totalMs: (i + 1) * 5_000 }));
    const layout = layoutFlow(nodes, [edge("e1", "a", "b"), edge("e2", "a", "c")]);
    for (const p of layout.nodes) {
      expect(p.x + p.w).toBeLessThanOrEqual(layout.width);
      expect(p.y + p.h).toBeLessThanOrEqual(layout.height);
    }
  });

  /**
   * Edges always run LEFT to RIGHT.
   *
   * A backwards edge in a left-to-right diagram reads as a loop. With longest-
   * path columns there are none, and this is what proves it stays that way.
   */
  it("routes every edge forwards", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => node({ id }));
    const layout = layoutFlow(nodes, [
      edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "d"), edge("e4", "a", "d"),
    ]);
    for (const e of layout.edges) {
      expect(e.x2, `${e.edge.source}→${e.edge.target} points backwards`)
        .toBeGreaterThanOrEqual(e.x1);
    }
  });

  /** An edge to a node that is not in the list is dropped, never drawn to nowhere. */
  it("ignores an edge whose endpoint is missing", () => {
    const layout = layoutFlow([node({ id: "a" })], [edge("e", "a", "ghost")]);
    expect(layout.edges).toHaveLength(0);
  });

  /** An edge touching an unreached node is dimmed — dashed, not deleted. */
  it("marks edges into unreached nodes rather than hiding them", () => {
    const layout = layoutFlow(
      [node({ id: "a" }), node({ id: "never", reached: false })],
      [edge("e", "a", "never", false)],
    );
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]!.dimmed).toBe(true);
  });
});

// ── Virtualisation ──────────────────────────────────────────────────────────

describe("virtualisation", () => {
  /** Below the threshold the bookkeeping costs more than it saves. */
  it("renders everything for a small graph", () => {
    const layout = layoutFlow(
      Array.from({ length: 10 }, (_, i) => node({ id: `n${i}` })),
      [],
    );
    expect(visibleNodes(layout.nodes, 0, 800)).toHaveLength(10);
  });

  /** Above it, only what is near the viewport — with a viewport of overscan. */
  it("windows a large graph and keeps an overscan margin", () => {
    const nodes = Array.from({ length: VIRTUALISE_ABOVE + 60 }, (_, i) =>
      node({ id: `n${i}` }));
    const edges = nodes.slice(1).map((n, i) => edge(`e${i}`, `n${i}`, n.id));
    const layout = layoutFlow(nodes, edges);

    const shown = visibleNodes(layout.nodes, 0, 800);
    expect(shown.length).toBeLessThan(layout.nodes.length);
    expect(shown.length).toBeGreaterThan(0);

    /* Scrolling to the far end shows the far end, and not the near one. */
    const far = visibleNodes(layout.nodes, layout.width - 800, 800);
    expect(far.at(-1)!.node.id).toBe(`n${nodes.length - 1}`);
    expect(far.some((p) => p.node.id === "n0")).toBe(false);
  });

  /** Zero-width viewport (a hidden tab) must not blank the graph. */
  it("falls back to rendering everything when the viewport is unmeasured", () => {
    const nodes = Array.from({ length: VIRTUALISE_ABOVE + 10 }, (_, i) => node({ id: `n${i}` }));
    const layout = layoutFlow(nodes, []);
    expect(visibleNodes(layout.nodes, 0, 0)).toHaveLength(layout.nodes.length);
  });
});

// ── The constraint ──────────────────────────────────────────────────────────

describe("one card per graph node", () => {
  /**
   * ACCEPTANCE: the run that produced the duplicated screenshot renders 4 nodes.
   *
   * The server groups executions into nodes; this asserts the CLIENT does not
   * re-expand them. A yielded node arrives with `attempts: 3` and one entry, and
   * must be placed exactly once.
   */
  it("places a yielded node once, however many times it executed", () => {
    const nodes = [
      node({ id: "n-manual", label: "Manual", totalMs: 13 }),
      node({ id: "n-agent-1", label: "Agent", totalMs: 135_000, attempts: 3,
             spanIds: ["s1", "s2", "s3"] }),
      node({ id: "n-agent-2", label: "Agent", totalMs: 1_700 }),
      node({ id: "n-end", label: "End", totalMs: 1 }),
    ];
    const layout = layoutFlow(nodes, [
      edge("e1", "n-manual", "n-agent-1"),
      edge("e2", "n-agent-1", "n-agent-2"),
      edge("e3", "n-agent-2", "n-end"),
    ]);

    expect(layout.nodes).toHaveLength(4);
    expect(layout.nodes.filter((p) => p.node.id === "n-agent-1")).toHaveLength(1);
    expect(layout.nodes.map((p) => p.node.label))
      .toEqual(["Manual", "Agent", "Agent", "End"]);
    expect(layout.edges).toHaveLength(3);
  });
});
