import { describe, expect, it } from "vitest";

import { describeDiff, diffGraphs } from "~/lib/api/graph-diff";

/**
 * Version diff, client-side from two graph_json payloads.
 *
 * Verifies the brief's assumption that no API work is needed: everything here
 * operates on the `graph` object the versions endpoint already returns.
 */

const base = {
  nodes: [
    { id: "n1", type: "agent", label: "Classify", position: { x: 0, y: 0 }, config: { model: "opus" } },
    { id: "n2", type: "tool", label: "Fetch", position: { x: 100, y: 0 }, config: { timeoutMs: 5000 } },
  ],
  edges: [{ id: "e1", source: "n1", target: "n2" }],
};

describe("diffGraphs", () => {
  it("reports an identical graph as identical", () => {
    const diff = diffGraphs(base, structuredClone(base));
    expect(diff.identical).toBe(true);
    expect(describeDiff(diff)).toBe("No changes to the graph.");
  });

  it("ignores canvas geometry — dragging a node is not a behaviour change", () => {
    const moved = structuredClone(base);
    moved.nodes[0].position = { x: 999, y: 42 };

    const diff = diffGraphs(base, moved);
    expect(diff.identical).toBe(true);
  });

  it("detects a changed config field with a dotted path", () => {
    const edited = structuredClone(base);
    edited.nodes[0].config.model = "sonnet";

    const diff = diffGraphs(base, edited);
    const changed = diff.nodes.find((n) => n.id === "n1");

    expect(changed?.kind).toBe("modified");
    expect(changed?.fields).toEqual([{ path: "config.model", before: "opus", after: "sonnet" }]);
  });

  it("detects added and removed nodes", () => {
    const edited = structuredClone(base);
    edited.nodes.push({
      id: "n3",
      type: "tool",
      label: "Notify",
      position: { x: 200, y: 0 },
      config: {},
    });
    edited.nodes = edited.nodes.filter((n) => n.id !== "n2");

    const diff = diffGraphs(base, edited);
    expect(diff.summary.added).toBe(1);
    expect(diff.summary.removed).toBe(1);
    expect(diff.nodes.find((n) => n.id === "n3")?.kind).toBe("added");
    expect(diff.nodes.find((n) => n.id === "n2")?.kind).toBe("removed");
  });

  it("detects edge changes", () => {
    const edited = structuredClone(base);
    edited.edges = [{ id: "e2", source: "n2", target: "n1" }];

    const diff = diffGraphs(base, edited);
    expect(diff.edges).toHaveLength(2); // one added, one removed
    expect(diff.edges.filter((e) => e.kind === "added")).toHaveLength(1);
    expect(diff.edges.filter((e) => e.kind === "removed")).toHaveLength(1);
  });

  it("treats array reordering as a change, not as equal", () => {
    const before = { nodes: [{ id: "n1", config: { tools: ["a", "b"] } }], edges: [] };
    const after = { nodes: [{ id: "n1", config: { tools: ["b", "a"] } }], edges: [] };

    // Tool precedence is meaningful; a diff that hides a reorder hides a bug.
    expect(diffGraphs(before, after).identical).toBe(false);
  });

  it("orders changes before unchanged rows, deterministically", () => {
    const edited = structuredClone(base);
    edited.nodes.push({ id: "n0", type: "tool", label: "Aaa", position: { x: 0, y: 0 }, config: {} });

    const kinds = diffGraphs(base, edited).nodes.map((n) => n.kind);
    expect(kinds[0]).toBe("added");
    expect(kinds.slice(1).every((k) => k === "unchanged")).toBe(true);
  });

  it("handles a missing or empty graph without throwing", () => {
    expect(diffGraphs(null, base).summary.added).toBe(2);
    expect(diffGraphs(base, null).summary.removed).toBe(2);
    expect(diffGraphs(null, null).identical).toBe(true);
    expect(diffGraphs({}, {}).identical).toBe(true);
  });

  it("summarises in one line", () => {
    const edited = structuredClone(base);
    edited.nodes[0].config.model = "sonnet";
    edited.nodes = edited.nodes.filter((n) => n.id !== "n2");

    expect(describeDiff(diffGraphs(base, edited))).toContain("1 removed");
    expect(describeDiff(diffGraphs(base, edited))).toContain("1 changed");
  });
});
