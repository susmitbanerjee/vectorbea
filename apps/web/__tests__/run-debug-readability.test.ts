import { describe, expect, it } from "vitest";
import { customStepTimeoutMs, defaultStepTimeoutMs } from "~/lib/workflows/step-timeouts";
import { layout, type Constellation, type ConstellationNode } from "~/components/app/debug/constellation-layout";
import { toFields } from "~/components/app/debug/step-io-panel";

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
});
