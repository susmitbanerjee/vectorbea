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
