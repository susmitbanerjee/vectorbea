import { describe, expect, it } from "vitest";
import {
  fromStoredGraph, toStoredGraph, triggerConfigFrom, toNodeKind,
} from "~/lib/workflows/graph-codec";
import type { BuilderGraph } from "~/lib/workflows/builder-graph";

/**
 * POSITIONS HAVE TO SURVIVE A ROUND TRIP.
 *
 * The reported bug was "every workflow shows one straight line of nodes, and
 * moving one does not stick". The cause was that the builder never read a
 * stored position — it ran the graph through dagre on every open — and never
 * wrote one, because its save was a `setTimeout` that called nothing.
 *
 * These tests pin the two halves that fix it: a stored position is decoded, and
 * an encoded graph carries positions back out. A regression in either one is
 * invisible on screen until somebody re-opens a workflow, which is exactly how
 * this survived as long as it did.
 */

const graph: BuilderGraph = {
  nodes: [
    { node: { id: "t1", name: "Every morning", kind: "trigger", config: { cron: "0 6 * * *", timezone: "Europe/London" } }, x: 240, y: 96 },
    { node: { id: "a1", name: "Draft outreach", kind: "llm", config: { model: "claude-sonnet-4" } }, x: 640, y: 352 },
    { node: { id: "g1", name: "Billing approves", kind: "approval", config: { approverGroup: "billing" } }, x: 1040, y: 96 },
  ],
  edges: [
    { id: "e1", source: "t1", target: "a1", kind: "standard" },
    { id: "e2", source: "a1", target: "g1", kind: "conditional", label: "has renewals" },
  ],
};

describe("graph codec round trip", () => {
  it("preserves every position through encode and decode", () => {
    const decoded = fromStoredGraph(toStoredGraph(graph));

    expect(decoded.needsLayout).toBe(false);
    expect(decoded.nodes.map((n) => ({ id: n.node.id, x: n.x, y: n.y }))).toEqual([
      { id: "t1", x: 240, y: 96 },
      { id: "a1", x: 640, y: 352 },
      { id: "g1", x: 1040, y: 96 },
    ]);
  });

  it("preserves names, kinds, config and edges", () => {
    const decoded = fromStoredGraph(toStoredGraph(graph));

    expect(decoded.nodes.map((n) => n.node.name)).toEqual([
      "Every morning", "Draft outreach", "Billing approves",
    ]);
    expect(decoded.nodes.map((n) => n.node.kind)).toEqual(["trigger", "llm", "approval"]);
    expect(decoded.nodes[1].node.config).toEqual({ model: "claude-sonnet-4" });
    expect(decoded.edges).toEqual([
      { id: "e1", source: "t1", target: "a1", kind: "standard" },
      { id: "e2", source: "a1", target: "g1", kind: "conditional", label: "has renewals" },
    ]);
  });

  it("writes the flat fields worker-kotlin deserialises, alongside the canvas ones", () => {
    // `WorkflowGraph.kt` reads `type`, `label` and `config` at the TOP level and
    // knows nothing about `data` or `position`. Writing only the canvas dialect
    // would round-trip the picture and lose the behaviour.
    const [node] = toStoredGraph(graph).nodes as Array<Record<string, unknown>>;

    expect(node.id).toBe("t1");
    expect(node.type).toBe("trigger");
    expect(node.label).toBe("Every morning");
    expect(node.config).toEqual({ cron: "0 6 * * *", timezone: "Europe/London" });
    expect(node.position).toEqual({ x: 240, y: 96 });
    expect(node.data).toMatchObject({ label: "Every morning", nodeType: "trigger" });
  });
});

describe("decoding graphs this app has already written", () => {
  it("reads the Architect's dialect, including its positions", () => {
    // Exactly what `compilePlanToGraphJson` emits.
    const decoded = fromStoredGraph({
      nodes: [{
        id: "trigger_auto",
        type: "trigger",
        position: { x: 120, y: 60 },
        data: { label: "Start", nodeType: "trigger", description: "Workflow trigger (cron)" },
      }],
      edges: [],
    });

    expect(decoded.needsLayout).toBe(false);
    expect(decoded.nodes[0]).toMatchObject({ x: 120, y: 60 });
    expect(decoded.nodes[0].node.name).toBe("Start");
    expect(decoded.nodes[0].node.kind).toBe("trigger");
  });

  it("reports needsLayout for a graph that has never been placed", () => {
    // The state every workflow in the database is in before its first save from
    // the new builder — nodes, no positions. This is the ONLY case that should
    // trigger auto-layout.
    const decoded = fromStoredGraph({
      nodes: [
        { id: "a", type: "trigger", label: "Start" },
        { id: "b", type: "http", label: "Fetch" },
      ],
      edges: [{ id: "e", source: "a", target: "b" }],
    });

    expect(decoded.needsLayout).toBe(true);
    expect(decoded.nodes).toHaveLength(2);
  });

  it("does not ask for a layout when positions are present", () => {
    const decoded = fromStoredGraph({
      nodes: [{ id: "a", type: "trigger", label: "Start", position: { x: 16, y: 48 } }],
      edges: [],
    });

    expect(decoded.needsLayout).toBe(false);
    expect(decoded.nodes[0]).toMatchObject({ x: 16, y: 48 });
  });

  it("maps execution node types onto canvas kinds without dropping the node", () => {
    expect(toNodeKind("http")).toBe("tool");
    expect(toNodeKind("db_query")).toBe("tool");
    expect(toNodeKind("join")).toBe("merge");
    expect(toNodeKind("human_approval")).toBe("approval");
    // An unrecognised type must stay visible: a node the canvas drops is a node
    // the next save deletes from the workflow.
    expect(toNodeKind("something_new")).toBe("tool");
  });

  it("survives a malformed graph rather than throwing into the render", () => {
    expect(fromStoredGraph(null).nodes).toEqual([]);
    expect(fromStoredGraph({}).nodes).toEqual([]);
    expect(fromStoredGraph({ nodes: "not an array" }).nodes).toEqual([]);
  });

  it("drops edges pointing at nodes that are not in the graph", () => {
    // React Flow drops these silently; dropping them here keeps the store and
    // the canvas agreeing about what exists.
    const decoded = fromStoredGraph({
      nodes: [{ id: "a", type: "trigger", position: { x: 0, y: 0 } }],
      edges: [{ id: "e", source: "a", target: "ghost" }],
    });

    expect(decoded.edges).toEqual([]);
  });
});

describe("trigger config lifted for the scheduler", () => {
  it("carries the cron off the trigger node so syncSchedule can materialise it", () => {
    // `WorkflowRoutes.syncSchedule` reads this. Without it, saving a workflow
    // deletes its schedule row and the cron silently stops firing.
    expect(triggerConfigFrom(graph)).toEqual({
      triggerType: "cron",
      type: "cron",
      cronExpression: "0 6 * * *",
      cron: "0 6 * * *",
      timezone: "Europe/London",
    });
  });

  it("reports a non-cron trigger as its own kind", () => {
    const manual: BuilderGraph = {
      nodes: [{ node: { id: "t", name: "Manual", kind: "trigger", config: { triggerType: "manual" } }, x: 0, y: 0 }],
      edges: [],
    };
    expect(triggerConfigFrom(manual)).toEqual({ triggerType: "manual", type: "manual" });
  });

  it("treats a trigger carrying a cron as a cron trigger whatever its type says", () => {
    const confused: BuilderGraph = {
      nodes: [{ node: { id: "t", name: "T", kind: "trigger", config: { triggerType: "manual", cron: "0 9 * * 1-5" } }, x: 0, y: 0 }],
      edges: [],
    };
    expect(triggerConfigFrom(confused)).toMatchObject({ triggerType: "cron", cronExpression: "0 9 * * 1-5" });
  });
});
