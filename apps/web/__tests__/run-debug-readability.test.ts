import { describe, expect, it } from "vitest";
import { customStepTimeoutMs, defaultStepTimeoutMs } from "~/lib/workflows/step-timeouts";
import { layout, type Constellation, type ConstellationNode } from "~/components/app/debug/constellation-layout";
import { toFields } from "~/components/app/debug/step-io-panel";
import { pairBudgets, readablePayload } from "~/components/app/debug/iterations-view";

describe("canvas timeout chip", () => {
  it("stays silent for defaults and for steps that do no work", () => {
    expect(customStepTimeoutMs("agent", 120_000)).toBeNull();
    expect(customStepTimeoutMs("checkpoint", 60_000)).toBeNull();
    expect(customStepTimeoutMs("checkpoint", 5_000)).toBeNull();
    expect(customStepTimeoutMs("tool", defaultStepTimeoutMs("tool"))).toBeNull();
    expect(customStepTimeoutMs("agent", undefined)).toBeNull();
  });

  it("shows a limit the author changed", () => {
    expect(customStepTimeoutMs("agent", 300_000)).toBe(300_000);
    expect(customStepTimeoutMs("tool", 60_000)).toBe(60_000);
  });
});

function agentNode(id: string, startedAt: string, tokens: number): ConstellationNode {
  return {
    id, stepId: id, parentId: null, depth: 0, status: "succeeded", role: null, agentName: id,
    stopReason: null, tokens, costCents: 0, iterations: 1, blockedReason: null, startedAt, endedAt: null,
  };
}

describe("agents graph for a workflow run", () => {
  it("lays sequential agent steps out in run order, without overlap", () => {
    const c: Constellation = {
      runId: "r", edges: [], cycles: [], derived: true,
      nodes: [
        agentNode("review", "2026-09-15T10:00:05Z", 40_000),
        agentNode("fetch", "2026-09-15T10:00:00Z", 40_000),
        agentNode("write", "2026-09-15T10:00:09Z", 40_000),
      ],
    };
    const l = layout(c);
    expect(l.nodes.map((n) => n.id)).toEqual(["fetch", "review", "write"]);
    expect(new Set(l.nodes.map((n) => n.y)).size).toBe(1);
    for (let i = 1; i < l.nodes.length; i++) {
      const a = l.nodes[i - 1]!;
      const b = l.nodes[i]!;
      expect(b.x - b.r).toBeGreaterThan(a.x + a.r);
    }
    expect(l.sequence.map((q) => `${q.from}>${q.to}`)).toEqual(["fetch>review", "review>write"]);
  });
});

describe("step payload fields", () => {
  it("labels each field and marks empty ones", () => {
    const fields = toFields(JSON.stringify({ repo: "acme/api", sha: "", content: "line one\nline two", count: 3 }));
    expect(fields).toEqual([
      { key: "repo", kind: "value", text: "acme/api" },
      { key: "sha", kind: "empty", text: "" },
      { key: "content", kind: "text", text: "line one\nline two" },
      { key: "count", kind: "value", text: "3" },
    ]);
  });

  it("keeps text that is not JSON", () => {
    expect(toFields("plain words")).toEqual([{ key: "Content", kind: "text", text: "plain words" }]);
  });

  it("unwraps a payload stored as a JSON string", () => {
    const stored = JSON.stringify(JSON.stringify({ title: "latest commit", files: [] }));
    expect(toFields(stored)).toEqual([
      { key: "title", kind: "value", text: "latest commit" },
      { key: "files", kind: "empty", text: "" },
    ]);
  });
});

describe("recorded agent steps with no handoffs", () => {
  it("are drawn in a row too, not a column", () => {
    const c: Constellation = {
      runId: "r", edges: [], cycles: [],
      nodes: [
        { ...agentNode("scout", "2026-09-15T10:00:00Z", 9_600), depth: 1 },
        { ...agentNode("reviewer", "2026-09-15T10:01:00Z", 21_000), depth: 1 },
      ],
    };
    const l = layout(c);
    expect(l.nodes[0]!.y).toBe(l.nodes[1]!.y);
    expect(l.sequence).toHaveLength(1);
  });
});

describe("budget meter", () => {
  it("pairs each limit with what was spent, and counts tool calls when unrecorded", () => {
    const rows = pairBudgets([
      { dimension: "costCents", used: 3, limit: null },
      { dimension: "iterations", used: 4, limit: null },
      { dimension: "maxCostCents", used: 0, limit: 50 },
      { dimension: "maxIterations", used: 0, limit: 10 },
      { dimension: "maxToolCalls", used: 0, limit: 5 },
      { dimension: "maxTotalTokens", used: 0, limit: 16_384 },
      { dimension: "tokens", used: 18_700, limit: null },
    ], 3);
    expect(rows).toEqual([
      { dimension: "tokens", used: 18_700, limit: 16_384 },
      { dimension: "toolCalls", used: 3, limit: 5 },
      { dimension: "iterations", used: 4, limit: 10 },
      { dimension: "costCents", used: 3, limit: 50 },
    ]);
  });
});

describe("stored payload text", () => {
  it("is unwrapped and indented", () => {
    expect(readablePayload(JSON.stringify("USER:\nReview this"))).toBe("USER:\nReview this");
    expect(readablePayload('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(readablePayload("… cut {")).toBe("… cut {");
  });
});
