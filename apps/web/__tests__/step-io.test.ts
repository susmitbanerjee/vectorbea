import { describe, expect, it } from "vitest";
import type { contracts } from "@vectorbea/shared";
import type { BuilderRegistry } from "~/components/app/builder/use-builder-registry";
import {
  parseStepRef, stepRef, stepInputs, stepOutputs, sourceSteps, suggestFor, consumersOf,
  readInputMapping, cleanFieldName, humanize,
} from "~/components/app/builder/step-io";
import { describeCron, nodeSummary } from "~/components/app/builder/node-summary";

/**
 * The model behind the builder's Inputs and Output tabs.
 *
 * What is asserted is that the builder writes what the worker reads: mappings in
 * `config.inputMapping` as `{{ steps.<id>.output.<field> }}`, agent fields from
 * the step's own `outputFields`, and no invented field for a step that has none.
 */

const slackTool = {
  id: "t-slack", workspaceId: "w", environmentId: "e",
  name: "Post a message (Slack)", slug: "post", type: "http",
  description: null, connectionId: "c1",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "Slack formatting works." }, thread_ts: { type: "string" } },
    required: ["text"],
  },
  outputSchema: {},
  config: { operationId: "slack.post", boundParameters: { channel: "C1" } },
  riskLevel: "medium", requiresApproval: false, timeoutMs: 10_000,
  retryPolicy: {}, idempotencyStrategy: null, status: "active",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
} as unknown as contracts.Tool;

const registry: BuilderRegistry = {
  agents: [], tools: [slackTool], connections: [], loading: false, failed: false,
  byToolId: new Map([[slackTool.id, slackTool]]), byAgentId: new Map(), byConnectionId: new Map(),
};

const node = (id: string, name: string, kind: string, config: Record<string, unknown> = {}) =>
  ({ node: { id, name, kind, config }, x: 0, y: 0 });

const nodes = [
  node("n1", "Daily", "trigger", { cron: "0 9 * * 1-5" }),
  node("n2", "Find changes", "agent", {
    agentId: "a1",
    outputFields: [{ name: "changes", type: "array", description: "One entry per change" }, { name: "changeCount", type: "number" }],
  }),
  node("n3", "Save changes", "checkpoint"),
  node("n4", "Review changes", "agent", { inputMapping: { changes: "{{ steps.n2.output.changes }}" } }),
  node("n5", "Post to Slack", "tool", { toolId: "t-slack", inputMapping: { text: "{{ steps.Review changes.output.content }}" } }),
];
const edges = [
  { source: "n1", target: "n2" }, { source: "n2", target: "n3" },
  { source: "n3", target: "n4" }, { source: "n4", target: "n5" },
];

describe("references", () => {
  it("writes the form the worker resolves, and reads it back by id or by step name", () => {
    expect(stepRef("n2", "changes")).toBe("{{ steps.n2.output.changes }}");
    expect(parseStepRef("{{ steps.n2.output.changes }}", nodes)).toEqual({ nodeId: "n2", path: "changes" });
    expect(parseStepRef("{{steps.Find changes.output.changeCount}}", nodes)).toEqual({ nodeId: "n2", path: "changeCount" });
    expect(parseStepRef("Review {{ steps.n2.output.changes }}", nodes)).toBeNull();
    expect(parseStepRef("plain text", nodes)).toBeNull();
  });

  it("reads the mapping off config, including the Architect's plural spelling", () => {
    expect(readInputMapping({ inputMappings: { a: "x", n: 3 } })).toEqual({ a: "x", n: "3" });
  });
});

describe("what a step receives", () => {
  it("a tool takes its schema's parameters, labelled as the tool dialog labelled them", () => {
    const inputs = stepInputs(nodes[4].node, registry);
    expect(inputs.map((i) => [i.id, i.label, i.required])).toEqual([
      ["text", "Message", true],
      ["thread_ts", "Reply in thread", false],
    ]);
  });

  it("an agent takes exactly what its author passes it, and nothing is required", () => {
    const inputs = stepInputs(nodes[3].node, registry);
    expect(inputs).toEqual([expect.objectContaining({ id: "changes", required: false, custom: true })]);
    expect(stepInputs(nodes[0].node, registry)).toEqual([]);
  });
});

describe("what a step produces", () => {
  it("an agent offers the fields declared on the step, then its full reply", () => {
    expect(stepOutputs(nodes[1].node, registry).map((f) => [f.path, f.kind])).toEqual([
      ["changes", "list"], ["changeCount", "number"], ["content", "text"],
    ]);
  });

  it("a checkpoint is skipped as a source and an unscheduled trigger offers nothing", () => {
    const sources = sourceSteps("n4", nodes, edges, registry);
    expect(sources.map((s) => [s.name, s.distance])).toEqual([["Find changes", 2]]);
  });

  it("an HTTP tool with no output schema offers its response, not invented fields", () => {
    expect(stepOutputs(nodes[4].node, registry).map((f) => f.path)).toEqual(["body", "statusCode"]);
  });

  it("suggests the earlier field with the same name, however it is spelled", () => {
    const sources = sourceSteps("n4", nodes, edges, registry);
    expect(suggestFor("change_count", sources)).toMatchObject({ nodeId: "n2", path: "changeCount", stepName: "Find changes" });
    expect(suggestFor("unrelated", sources)).toBeNull();
  });

  it("lists who reads a step's fields", () => {
    expect(consumersOf("n2", nodes)).toEqual([{ nodeId: "n4", nodeName: "Review changes", inputId: "changes", path: "changes" }]);
    expect(consumersOf("n4", nodes)).toEqual([{ nodeId: "n5", nodeName: "Post to Slack", inputId: "text", path: "content" }]);
  });
});

describe("names and summaries", () => {
  it("cleans field names to what the worker accepts", () => {
    expect(cleanFieldName("change count!")).toBe("change_count");
    expect(humanize("recommendationCount")).toBe("Recommendation count");
  });

  it("says what a step does instead of describing its icon", () => {
    expect(describeCron("0 9 * * *")).toBe("Every day at 09:00");
    expect(describeCron("0 9 * * 1-5")).toBe("Weekdays at 09:00");
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(nodeSummary({ kind: "checkpoint", config: {} })).toBe("Saves progress");
  });
});
