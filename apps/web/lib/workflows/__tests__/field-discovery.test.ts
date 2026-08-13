/**
 * Field Discovery Tests
 * Verifies that buildAvailableFieldsForNode correctly enforces:
 * - Only upstream nodes are returned (never future nodes)
 * - Workflow input is always available
 * - Disconnected nodes are excluded
 * - Topology traversal is correct
 */

import { getUpstreamNodeIds, buildAvailableFieldsForNode } from "../field-discovery";
import type { Edge } from "@xyflow/react";

// ─── Mock nodes ───────────────────────────────────────────────────────────────

function node(id: string, nodeType = "tool", label = id) {
  return {
    id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: { label, nodeType, previewStatus: "idle" },
  } as any;
}

function edge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target, type: "workflow", data: { edgeType: "default" } };
}

// ─── getUpstreamNodeIds ───────────────────────────────────────────────────────

describe("getUpstreamNodeIds", () => {
  test("returns empty set for a node with no predecessors", () => {
    const edges: Edge[] = [];
    expect(getUpstreamNodeIds("n1", edges)).toEqual(new Set());
  });

  test("returns immediate parent", () => {
    const edges = [edge("n1", "n2")];
    const upstream = getUpstreamNodeIds("n2", edges);
    expect(upstream.has("n1")).toBe(true);
    expect(upstream.size).toBe(1);
  });

  test("returns all ancestors transitively", () => {
    // n1 → n2 → n3
    const edges = [edge("n1", "n2"), edge("n2", "n3")];
    const upstream = getUpstreamNodeIds("n3", edges);
    expect(upstream.has("n1")).toBe(true);
    expect(upstream.has("n2")).toBe(true);
    expect(upstream.size).toBe(2);
  });

  test("does NOT include the target node itself", () => {
    const edges = [edge("n1", "n2")];
    const upstream = getUpstreamNodeIds("n2", edges);
    expect(upstream.has("n2")).toBe(false);
  });

  test("excludes downstream nodes (future references)", () => {
    // n1 → n2 → n3 (target) → n4 (future)
    const edges = [edge("n1", "n2"), edge("n2", "n3"), edge("n3", "n4")];
    const upstream = getUpstreamNodeIds("n3", edges);
    expect(upstream.has("n4")).toBe(false);
    expect(upstream.has("n1")).toBe(true);
    expect(upstream.has("n2")).toBe(true);
  });

  test("handles branching correctly", () => {
    // n1 → n3, n2 → n3 (target)
    const edges = [edge("n1", "n3"), edge("n2", "n3")];
    const upstream = getUpstreamNodeIds("n3", edges);
    expect(upstream.has("n1")).toBe(true);
    expect(upstream.has("n2")).toBe(true);
  });

  test("handles parallel fan-out correctly", () => {
    // n1 → n2, n1 → n3, n2 → n4 (target), n3 NOT upstream of n4
    const edges = [edge("n1", "n2"), edge("n1", "n3"), edge("n2", "n4")];
    const upstream = getUpstreamNodeIds("n4", edges);
    expect(upstream.has("n1")).toBe(true);
    expect(upstream.has("n2")).toBe(true);
    expect(upstream.has("n3")).toBe(false); // sibling, not ancestor
  });
});

// ─── buildAvailableFieldsForNode ─────────────────────────────────────────────

describe("buildAvailableFieldsForNode", () => {
  test("workflow input is always available", () => {
    const nodes = [node("n1", "trigger"), node("n2", "agent")];
    const edges = [edge("n1", "n2")];
    const sources = buildAvailableFieldsForNode("n2", nodes, edges);
    const wfInput = sources.find(s => s.sourceId === "workflow_input");
    expect(wfInput).toBeDefined();
    expect(wfInput?.isWorkflowInput).toBe(true);
  });

  test("run metadata is always available", () => {
    const sources = buildAvailableFieldsForNode("n1", [node("n1")], []);
    const meta = sources.find(s => s.sourceId === "run_metadata");
    expect(meta).toBeDefined();
  });

  test("upstream node is included", () => {
    const nodes = [node("n1", "agent", "Fetch Data"), node("n2", "agent")];
    const edges = [edge("n1", "n2")];
    const sources = buildAvailableFieldsForNode("n2", nodes, edges);
    const upstream = sources.find(s => s.sourceId === "n1");
    expect(upstream).toBeDefined();
    expect(upstream?.label).toBe("Fetch Data");
  });

  test("future node is excluded", () => {
    const nodes = [node("n1"), node("n2"), node("n3")];
    const edges = [edge("n1", "n2"), edge("n2", "n3")];
    // n2 should NOT see n3 (future)
    const sources = buildAvailableFieldsForNode("n2", nodes, edges);
    const future = sources.find(s => s.sourceId === "n3");
    expect(future).toBeUndefined();
  });

  test("disconnected node is excluded", () => {
    const nodes = [node("n1"), node("disconnected"), node("n2")];
    const edges = [edge("n1", "n2")]; // disconnected has no edges
    const sources = buildAvailableFieldsForNode("n2", nodes, edges);
    const disc = sources.find(s => s.sourceId === "disconnected");
    expect(disc).toBeUndefined();
  });

  test("workflow input schema fields are included", () => {
    const schema = {
      type: "object",
      properties: {
        customerId: { type: "string", description: "Customer ID" },
        region:     { type: "string" },
      },
    };
    const sources = buildAvailableFieldsForNode("n1", [node("n1")], [], {}, schema as any);
    const wfInput = sources.find(s => s.isWorkflowInput);
    expect(wfInput?.fields.some(f => f.path === "customerId")).toBe(true);
    expect(wfInput?.fields.some(f => f.path === "region")).toBe(true);
  });
});
