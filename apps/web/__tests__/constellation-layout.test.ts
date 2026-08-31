import { describe, expect, it } from "vitest";
import {
  layout,
  joinGroups,
  radiusFor,
  type Constellation,
  type ConstellationEdge,
  type ConstellationNode,
} from "~/components/app/debug/constellation-layout";

/* ══════════════════════════════════════════════════════════════════════════════
   The acceptance case is here rather than in a screenshot: "a 12-activation tree
   with a cycle renders legibly without manual layout" is a claim about
   coordinates, and coordinates are testable.

   "Legibly" is made concrete as four properties nothing else in the view can
   fix: every node is placed, no two overlap, depth reads top-to-bottom, and the
   cycle is a counted loop rather than an edge crossing the diagram.
   ══════════════════════════════════════════════════════════════════════════ */

function node(over: Partial<ConstellationNode> & { id: string }): ConstellationNode {
  return {
    parentId: null, depth: 0, status: "succeeded", role: "worker",
    agentName: over.id, stopReason: null, tokens: 100, costCents: 1,
    iterations: 1, blockedReason: null, startedAt: null, endedAt: null,
    ...over,
  };
}

function edge(over: Partial<ConstellationEdge> & { id: string; to: string }): ConstellationEdge {
  return {
    from: null, kind: "DELEGATE", reason: null, contractHash: "h",
    joinGroupId: null, createdAt: null, contract: null, output: null,
    ...over,
  };
}

/** A supervisor, three mid-level agents, eight leaves, and one cycle. */
function twelveWithCycle(): Constellation {
  const nodes: ConstellationNode[] = [
    node({ id: "sup", depth: 0, agentName: "supervisor", tokens: 4000 }),
    node({ id: "m1", depth: 1, parentId: "sup", agentName: "researcher", tokens: 9000 }),
    node({ id: "m2", depth: 1, parentId: "sup", agentName: "writer", tokens: 500 }),
    node({ id: "m3", depth: 1, parentId: "sup", agentName: "reviewer", tokens: 0,
      status: "cancelled", blockedReason: "Never started — the join was already satisfied." }),
    ...Array.from({ length: 8 }, (_, i) =>
      node({ id: `leaf${i}`, depth: 2, parentId: i < 4 ? "m1" : "m2",
             agentName: `leaf-${i}`, tokens: 200 + i * 50 })),
  ];
  const edges: ConstellationEdge[] = [
    edge({ id: "e-m1", from: "sup", to: "m1" }),
    edge({ id: "e-m2", from: "sup", to: "m2" }),
    edge({ id: "e-m3", from: "sup", to: "m3" }),
    ...Array.from({ length: 8 }, (_, i) =>
      edge({ id: `e-leaf${i}`, from: i < 4 ? "m1" : "m2", to: `leaf${i}` })),
    /* The cycle: the researcher asked the same thing twice. */
    edge({ id: "e-cycle", from: "m1", to: "leaf0", contractHash: "same" }),
  ];
  return {
    runId: "run-1",
    nodes,
    edges,
    cycles: [{
      fromAgent: "researcher", toAgent: "leaf-0", contractHash: "same",
      hits: 2, edgeIds: ["e-leaf0", "e-cycle"], kind: "DELEGATE",
    }],
  };
}

describe("constellation layout", () => {
  it("places a 12-activation tree with a cycle, with no overlaps", () => {
    const c = twelveWithCycle();
    expect(c.nodes).toHaveLength(12);

    const l = layout(c);
    expect(l.nodes).toHaveLength(12);

    // Every node has real coordinates — a NaN here renders as nothing at all.
    for (const n of l.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.r).toBeGreaterThan(0);
    }

    /*
     * NO OVERLAPS. This is what "legibly" means concretely: two circles on top
     * of each other are one circle as far as a reader is concerned, and the node
     * underneath cannot be clicked.
     */
    for (let i = 0; i < l.nodes.length; i++) {
      for (let j = i + 1; j < l.nodes.length; j++) {
        const a = l.nodes[i]!;
        const b = l.nodes[j]!;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        expect(dist).toBeGreaterThan(a.r + b.r);
      }
    }
  });

  it("reads top to bottom by depth", () => {
    const l = layout(twelveWithCycle());
    const y = (id: string) => l.nodes.find((n) => n.id === id)!.y;
    /* Depth IS the thing being read — who called whom. A layout that throws it
       away and re-derives an arrangement from edge tension has lost the point. */
    expect(y("sup")).toBeLessThan(y("m1"));
    expect(y("m1")).toBeLessThan(y("leaf0"));
    expect(y("m1")).toBe(y("m2"));
  });

  it("is deterministic, so two people see the same diagram", () => {
    const a = layout(twelveWithCycle());
    const b = layout(twelveWithCycle());
    /* "The writer node, top right" has to mean something to a colleague, and a
       screenshot in an incident has to match what the next person opens. */
    expect(a.nodes.map((n) => [n.id, n.x, n.y])).toEqual(b.nodes.map((n) => [n.id, n.x, n.y]));
  });

  it("renders the cycle as one counted loop, not as a crossing edge", () => {
    const l = layout(twelveWithCycle());
    expect(l.loops).toHaveLength(1);
    expect(l.loops[0]!.hits).toBe(2);
    /* Anchored on the agent doing the asking, so "this agent kept asking the
       same question" reads off the diagram at the right node. */
    const m1 = l.nodes.find((n) => n.id === "m1")!;
    expect(l.loops[0]!.x).toBe(m1.x);

    // And both of its edges are marked, so neither draws as an ordinary one.
    expect(l.edges.filter((e) => e.cyclic).map((e) => e.id).sort())
      .toEqual(["e-cycle", "e-leaf0"]);
  });

  it("scales node area with tokens, not radius", () => {
    /*
     * The eye reads AREA as magnitude. A linear radius makes a 10× spend look
     * 100× bigger and swamps the diagram, so the expensive member stops being
     * obvious and starts being the only thing visible.
     */
    const r1 = radiusFor(100, 10_000);
    const r10 = radiusFor(1_000, 10_000);
    const rMax = radiusFor(10_000, 10_000);
    expect(r1).toBeLessThan(r10);
    expect(r10).toBeLessThan(rMax);
    expect(rMax / r1).toBeLessThan(4);
  });

  it("keeps a zero-token node clickable", () => {
    /* A blocked activation has spent nothing and is very often the node
       somebody opened the view to look at. */
    expect(radiusFor(0, 10_000)).toBeGreaterThanOrEqual(14);
    const l = layout(twelveWithCycle());
    expect(l.nodes.find((n) => n.id === "m3")!.r).toBeGreaterThanOrEqual(14);
  });

  it("marks a blocked activation so the absence is explained", () => {
    const l = layout(twelveWithCycle());
    const m3 = l.nodes.find((n) => n.id === "m3")!;
    /* A node with no spans and no output is indistinguishable from a rendering
       bug unless something says why. */
    expect(m3.blocked).toBe(true);
    expect(m3.blockedReason).toContain("Never started");
  });

  it("handles an empty run without dividing by zero", () => {
    const l = layout({ runId: "r", nodes: [], edges: [], cycles: [] });
    expect(l.nodes).toEqual([]);
    expect(Number.isFinite(l.width)).toBe(true);
  });

  it("survives an edge whose endpoints are missing from a truncated trace", () => {
    const l = layout({
      runId: "r",
      nodes: [node({ id: "a" })],
      edges: [edge({ id: "e", from: "ghost", to: "a" }), edge({ id: "e2", from: "a", to: "ghost" })],
      cycles: [],
    });
    /* The edge INTO a real node survives with a stub origin; the one into a
       missing node is dropped rather than drawn to a coordinate nobody has. */
    expect(l.edges.map((e) => e.id)).toEqual(["e"]);
  });
});

describe("join groups", () => {
  it("groups one broadcast's children together", () => {
    const edges = [
      edge({ id: "1", to: "a", joinGroupId: "g1" }),
      edge({ id: "2", to: "b", joinGroupId: "g1" }),
      edge({ id: "3", to: "c", joinGroupId: "g1" }),
      edge({ id: "4", to: "d" }),
    ];
    const g = joinGroups(edges);
    expect(g.size).toBe(1);
    expect(g.get("g1")).toHaveLength(3);
  });

  it("does not bracket a group of one", () => {
    /* A "fan-out" of one is a plain delegation that happened to carry a group
       id, and bracketing it would claim something that did not happen. */
    expect(joinGroups([edge({ id: "1", to: "a", joinGroupId: "g1" })]).size).toBe(0);
  });
});
