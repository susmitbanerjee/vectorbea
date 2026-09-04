import { describe, expect, it } from "vitest";

import { LATTICE, autoLayout, snap } from "~/components/app/builder/layout";
import { NODE_SIZE } from "~/components/app/builder/store";
import type { BuilderEdge, BuilderNode } from "~/mocks/builder";

/**
 * Auto-layout must land on the lattice, evenly.
 *
 * THE BUG THIS PINS. Dagre's separations are gaps; the canvas snaps positions.
 * Those two only agree when the PITCH — node size plus gap — is itself a
 * multiple of the lattice. It was not: 200 + 96 = 296 leaves a remainder of 8,
 * so consecutive nodes rounded in opposite directions and a laid-out row came
 * out spaced 288, 304, 288, 304 … The sawtooth is a full 16px, which is plainly
 * visible, and it appeared on a canvas whose whole promise is that things line
 * up. Vertically, 76 + 48 left a remainder of 12 and parallel branches drifted
 * by a different amount at every rank.
 */
describe("auto-layout lands on the lattice", () => {
  const node = (id: string): BuilderNode =>
    ({ node: { id, type: "task", name: id }, x: 0, y: 0 }) as unknown as BuilderNode;

  const chain = (count: number) => {
    const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`));
    const edges = Array.from({ length: count - 1 }, (_, i) => ({
      id: `e${i}`,
      source: `n${i}`,
      target: `n${i + 1}`,
    })) as unknown as BuilderEdge[];
    return { nodes, edges };
  };

  it("spaces a chain evenly rather than in a sawtooth", () => {
    const { nodes, edges } = chain(10);
    const laid = autoLayout(nodes, edges);

    const xs = laid.nodes.map((n) => n.x).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);

    // Every gap identical — this is the assertion that used to fail, with
    // gaps alternating 288 and 304.
    expect(new Set(gaps).size, `gaps were ${gaps.join(", ")}`).toBe(1);
  });

  it("puts every node on the lattice", () => {
    const { nodes, edges } = chain(8);
    const laid = autoLayout(nodes, edges);
    for (const n of laid.nodes) {
      expect(n.x % LATTICE, `x=${n.x}`).toBe(0);
      expect(n.y % LATTICE, `y=${n.y}`).toBe(0);
    }
  });

  it("keeps the horizontal and vertical pitch divisible by the lattice", () => {
    /* The invariant behind both tests above, asserted directly so that changing
       NODE_SIZE or LATTICE fails HERE — where the arithmetic is explained —
       rather than as a mysterious spacing regression on the canvas. */
    const RANKSEP = LATTICE * 19 - NODE_SIZE.width;
    const NODESEP = LATTICE * 8 - NODE_SIZE.height;

    expect((NODE_SIZE.width + RANKSEP) % LATTICE).toBe(0);
    expect((NODE_SIZE.height + NODESEP) % LATTICE).toBe(0);
    // And still generous enough for the edge labels on conditional arms.
    expect(RANKSEP).toBeGreaterThanOrEqual(96);
    expect(NODESEP).toBeGreaterThanOrEqual(48);
  });

  it("branches that fan out stay on a single vertical rhythm", () => {
    const nodes = [node("root"), node("a"), node("b"), node("c")];
    const edges = [
      { id: "e1", source: "root", target: "a" },
      { id: "e2", source: "root", target: "b" },
      { id: "e3", source: "root", target: "c" },
    ] as unknown as BuilderEdge[];

    const laid = autoLayout(nodes, edges);
    const branch = laid.nodes.filter((n) => n.node.id !== "root").map((n) => n.y).sort((a, b) => a - b);
    const gaps = branch.slice(1).map((y, i) => y - branch[i]);
    expect(new Set(gaps).size, `gaps were ${gaps.join(", ")}`).toBe(1);
  });

  it("snap is a pure round to the nearest lattice step", () => {
    expect(snap(0)).toBe(0);
    expect(snap(7)).toBe(0);
    expect(snap(8)).toBe(LATTICE);
    expect(snap(-8)).toBe(-0);
    expect(snap(LATTICE * 3 + 1)).toBe(LATTICE * 3);
  });
});
