import { describe, expect, it } from "vitest";
import { builderReducer, initialStore } from "~/components/app/builder/store";
import type { BuilderGraph } from "~/lib/workflows/builder-graph";

const graph: BuilderGraph = {
  nodes: [
    { node: { id: "a", name: "A", kind: "agent", config: {} }, x: 0, y: 0 },
    { node: { id: "b", name: "B", kind: "tool", config: {} }, x: 240, y: 0 },
    { node: { id: "c", name: "C", kind: "output", config: {} }, x: 480, y: 0 },
  ],
  edges: [{ id: "e-a-b", source: "a", target: "b", kind: "standard" }],
};

function seededStore() {
  const base = initialStore(graph);
  return { ...base, snapshots: [base.state] };
}

describe("builder edge editing", () => {
  it("marks the graph dirty only when a node drag is committed", () => {
    const duringDrag = builderReducer(seededStore(), {
      type: "move",
      positions: { a: { x: 32, y: 48 } },
      commit: false,
    });
    expect(duringDrag.state.dirty).toBe(false);

    const afterDrop = builderReducer(duringDrag, {
      type: "move",
      positions: { a: { x: 32, y: 48 } },
      commit: true,
    });
    expect(afterDrop.state.dirty).toBe(true);
  });

  /**
   * THE DRAG BLINK, AS AN INVARIANT.
   *
   * `Canvas` keeps its per-node decoration (`boundResource`, `nodeChrome`)
   * stable across a drag by holding the node list still whenever the same
   * `VersionNode` objects come back — see `useStable` in canvas.tsx. Every node
   * on the canvas re-renders on every pointer frame if that identity is not
   * preserved, which is what the flicker was.
   *
   * That protection is invisible from the canvas: it depends entirely on the
   * reducer replacing the POSITION WRAPPER and not the node inside it. Writing
   * `{ ...n, node: { ...n.node } }` here would look harmless, pass every other
   * test, and silently bring the blink back. So it is asserted where it is
   * decided.
   */
  it("preserves node identity across a move, which is what stops the canvas flickering", () => {
    const before = seededStore();
    const after = builderReducer(before, {
      type: "move",
      positions: { a: { x: 64, y: 96 } },
      commit: false,
    });

    const nodeA = (store: typeof before) => store.state.nodes.find((n) => n.node.id === "a")!;
    const nodeB = (store: typeof before) => store.state.nodes.find((n) => n.node.id === "b")!;

    // The moved node's position changed...
    expect(nodeA(after).x).toBe(64);
    expect(nodeA(after).y).toBe(96);
    // ...but the VersionNode inside it is the very same object.
    expect(nodeA(after).node).toBe(nodeA(before).node);
    // A node that did not move is untouched down to its wrapper.
    expect(nodeB(after)).toBe(nodeB(before));
  });

  it("keeps identity stable when a move changes nothing", () => {
    // Pointer frames that land on the same snapped coordinate are common, and
    // each one still runs the reducer.
    const before = seededStore();
    const after = builderReducer(before, {
      type: "move",
      positions: { a: { x: 0, y: 0 } },
      commit: false,
    });
    expect(after.state.nodes.every((n, i) => n.node === before.state.nodes[i].node)).toBe(true);
  });

  it("creates an edge in the direction the user dragged", () => {
    const next = builderReducer(seededStore(), {
      type: "connect",
      source: "c",
      target: "a",
    });

    expect(next.state.edges).toContainEqual(
      expect.objectContaining({ source: "c", target: "a" }),
    );
  });

  it("reconnects either endpoint while preserving the edge identity", () => {
    const next = builderReducer(seededStore(), {
      type: "reconnectEdge",
      id: "e-a-b",
      source: "c",
      target: "a",
    });

    expect(next.state.edges).toContainEqual(
      expect.objectContaining({
        id: "e-a-b",
        source: "c",
        target: "a",
      }),
    );
    expect(next.state.selectedEdgeId).toBe("e-a-b");
  });

  it("deletes a selected edge without deleting either node", () => {
    const next = builderReducer(seededStore(), { type: "deleteEdge", id: "e-a-b" });

    expect(next.state.edges).toHaveLength(0);
    expect(next.state.nodes).toHaveLength(3);
  });
});
