import { describe, expect, it } from "vitest";
import type { contracts } from "@vectorbea/shared";
import {
  resolveTool,
  resolveAgent,
  resolveConnection,
  boundResourceFor,
  type BuilderRegistry,
} from "~/components/app/builder/use-builder-registry";
import { toolInputDeclarations } from "~/components/app/builder/inspector/node-inputs";

/**
 * The canvas binds nodes to registry objects, and the graph it writes is what
 * the engine executes.
 *
 * Two rules are asserted throughout:
 *
 *   1. A NODE RESOLVES BY ID FIRST. Graphs written before this bound by display
 *      name, so name resolution has to keep working — but an id must always
 *      win, or renaming a tool would silently repoint every node that referred
 *      to it.
 *   2. NAMING SOMETHING ABSENT IS AN ERROR, NOT AN EMPTY STATE. A node that
 *      names a tool the workspace does not have will fail at run time, and the
 *      canvas has to say so rather than render a blank subtitle.
 */

const tool = (over: Partial<contracts.Tool>): contracts.Tool => ({
  id: "11111111-1111-1111-1111-111111111111",
  workspaceId: "w", environmentId: "e",
  name: "stripe.getInvoice", slug: "stripe-getinvoice", type: "http",
  description: null, connectionId: null,
  inputSchema: {}, outputSchema: {}, config: {},
  riskLevel: "low", requiresApproval: false, timeoutMs: 10_000,
  retryPolicy: {}, idempotencyStrategy: null, status: "active",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  ...over,
} as contracts.Tool);

const agent = (over: Partial<contracts.Agent>): contracts.Agent => ({
  id: "22222222-2222-2222-2222-222222222222",
  workspaceId: "w", environmentId: "e",
  name: "Triage agent", slug: "triage-agent", type: "react",
  role: null, instructions: null, llmConnectionId: null,
  modelName: "claude-opus-5", temperature: 0, maxTokens: 2048, maxIterations: 4,
  memoryPolicy: {}, retryPolicy: {}, timeoutPolicy: {}, approvalPolicy: {},
  allowedToolIds: [], outputSchema: {}, status: "active",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  ...over,
} as contracts.Agent);

const connection = (over: Partial<contracts.Connection>): contracts.Connection => ({
  id: "33333333-3333-3333-3333-333333333333",
  workspaceId: "w", environmentId: "e",
  name: "Billing Postgres", slug: "billing-postgres", type: "database",
  provider: "postgresql", status: "active", networkStatus: "ok",
  authType: "api_key", secretConfigured: true, config: {},
  allowedHosts: [], allowedPaths: [], allowedSchemas: [], allowedTables: [],
  lastTestedAt: null, lastTestStatus: null, lastTestLatencyMs: null,
  lastTestErrorCode: null, lastTestErrorMessageSanitized: null,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  ...over,
} as contracts.Connection);

function registryOf(
  tools: contracts.Tool[] = [],
  agents: contracts.Agent[] = [],
  connections: contracts.Connection[] = [],
  loading = false,
): BuilderRegistry {
  return {
    tools, agents, connections,
    loading, failed: false,
    byToolId: new Map(tools.map((t) => [t.id, t])),
    byAgentId: new Map(agents.map((a) => [a.id, a])),
    byConnectionId: new Map(connections.map((c) => [c.id, c])),
  };
}

describe("resolveTool", () => {
  const a = tool({ id: "id-a", name: "stripe.getInvoice", slug: "stripe-getinvoice" });
  const b = tool({ id: "id-b", name: "slack.postMessage", slug: "slack-postmessage" });
  const registry = registryOf([a, b]);

  it("prefers the id over the name when they disagree", () => {
    // The name says one tool, the id says another. The id is the binding the
    // engine executes, so it must be the one the canvas shows.
    expect(resolveTool({ toolId: "id-b", tool: "stripe.getInvoice" }, registry)).toBe(b);
  });

  it("falls back to the name for graphs written before ids", () => {
    expect(resolveTool({ tool: "slack.postMessage" }, registry)).toBe(b);
  });

  it("falls back to the name when the id is stale", () => {
    expect(resolveTool({ toolId: "deleted", tool: "slack.postMessage" }, registry)).toBe(b);
  });

  it("matches a name case-insensitively, and by slug", () => {
    expect(resolveTool({ tool: "SLACK.POSTMESSAGE" }, registry)).toBe(b);
    expect(resolveTool({ tool: b.slug }, registry)).toBe(b);
  });

  it("returns null rather than guessing", () => {
    expect(resolveTool({ tool: "does.notExist" }, registry)).toBeNull();
    expect(resolveTool({}, registry)).toBeNull();
  });
});

describe("resolveAgent", () => {
  const one = agent({ id: "ag-1", name: "Triage agent", modelName: "claude-opus-5" });
  const two = agent({ id: "ag-2", name: "Summariser", modelName: "claude-sonnet-5" });
  const registry = registryOf([], [one, two]);

  it("prefers the id", () => {
    expect(resolveAgent({ agentId: "ag-2", model: "claude-opus-5" }, registry)).toBe(two);
  });

  it("still resolves the oldest binding, which was a bare model name", () => {
    expect(resolveAgent({ model: "claude-sonnet-5" }, registry)).toBe(two);
  });

  it("returns null when nothing matches", () => {
    expect(resolveAgent({ model: "gpt-4" }, registry)).toBeNull();
  });
});

describe("resolveConnection", () => {
  const c = connection({ id: "cn-1", name: "Billing Postgres" });
  const registry = registryOf([], [], [c]);

  it("resolves by id and by name", () => {
    expect(resolveConnection({ connectionId: "cn-1" }, registry)).toBe(c);
    expect(resolveConnection({ connection: "billing postgres" }, registry)).toBe(c);
  });
});

describe("boundResourceFor", () => {
  const pg = connection({ id: "cn-1", name: "Billing Postgres", provider: "postgresql", status: "active" });
  const t = tool({ id: "id-a", name: "billing.read", connectionId: "cn-1", riskLevel: "high" });
  const registry = registryOf([t], [], [pg]);

  it("labels a bound tool and names its connection", () => {
    const out = boundResourceFor({ kind: "tool", config: { toolId: "id-a" } }, registry);
    expect(out).toMatchObject({ label: "billing.read", detail: "Billing Postgres", missing: false, connected: true });
  });

  it("maps a provider the logo set does not carry onto one it does", () => {
    // The API says "postgresql"; the logo set only knows "postgres".
    expect(boundResourceFor({ kind: "tool", config: { toolId: "id-a" } }, registry)?.provider).toBe("postgres");
  });

  it("does not invent a logo for an unknown provider", () => {
    const odd = registryOf(
      [tool({ id: "id-x", name: "x", connectionId: "cn-x", type: "sap" })],
      [],
      [connection({ id: "cn-x", provider: "sap", type: "sap" })],
    );
    expect(boundResourceFor({ kind: "tool", config: { toolId: "id-x" } }, odd)?.provider).toBeNull();
  });

  it("FLAGS a node naming a tool the workspace does not have", () => {
    const out = boundResourceFor({ kind: "tool", config: { tool: "ghost.tool" } }, registry);
    expect(out).toMatchObject({ label: "ghost.tool", missing: true, detail: "Not in this workspace" });
  });

  it("does not flag anything while the registry is still loading", () => {
    // Calling a tool missing before its list has arrived would make every node
    // flash an error on open.
    const out = boundResourceFor({ kind: "tool", config: { tool: "ghost.tool" } }, registryOf([], [], [], true));
    expect(out?.missing).toBe(false);
    expect(out?.detail).toBeNull();
  });

  it("returns null for a node that binds nothing", () => {
    expect(boundResourceFor({ kind: "tool", config: {} }, registry)).toBeNull();
    expect(boundResourceFor({ kind: "branch", config: {} }, registry)).toBeNull();
  });

  it("treats a model name on an llm node as a label, not a missing agent", () => {
    // An `llm` step legitimately names a model without naming an agent.
    const out = boundResourceFor({ kind: "llm", config: { model: "gpt-4o" } }, registry);
    expect(out).toMatchObject({ label: "gpt-4o", missing: false });
  });

  it("flags an agent node that claims an agent it cannot find", () => {
    const out = boundResourceFor({ kind: "agent", config: { agentId: "gone", agentName: "Ghost" } }, registry);
    expect(out?.missing).toBe(true);
  });
});

describe("toolInputDeclarations", () => {
  it("reads the tool's own schema, with required and defaults honoured", () => {
    const t = tool({
      name: "billing.read",
      inputSchema: {
        type: "object",
        properties: {
          invoiceId: { type: "string", description: "The invoice to read." },
          limit: { type: "integer", default: 50 },
          includeVoid: { type: "boolean" },
        },
        required: ["invoiceId"],
      },
    });
    const out = toolInputDeclarations(t)!;
    expect(out.map((d) => d.id)).toEqual(["invoiceId", "limit", "includeVoid"]);

    const [invoiceId, limit, includeVoid] = out;
    expect(invoiceId).toMatchObject({ type: "string", required: true, nullPolicy: "fail" });
    // An integer is a number to the inspector, and a default makes it usable.
    expect(limit).toMatchObject({ type: "number", required: false, nullPolicy: "use-default", defaultValue: 50 });
    // Optional with no default: null is a legitimate value to pass through.
    expect(includeVoid).toMatchObject({ type: "boolean", nullPolicy: "pass-null" });
  });

  it("reads through a nullable type union", () => {
    const t = tool({
      inputSchema: { type: "object", properties: { note: { type: ["string", "null"] } } },
    });
    expect(toolInputDeclarations(t)![0].type).toBe("string");
  });

  it("returns null when the schema declares nothing, so the caller can fall back", () => {
    expect(toolInputDeclarations(tool({ inputSchema: {} }))).toBeNull();
    expect(toolInputDeclarations(tool({ inputSchema: { type: "object", properties: {} } }))).toBeNull();
  });
});
