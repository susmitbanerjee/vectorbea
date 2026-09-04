import { BLUEPRINT, type BlueprintNode } from "./architect";

/* ══════════════════════════════════════════════════════════════════════════════
   THE ARCHITECT, IN API SHAPES

   `architect.ts` holds the fixture as the CANVAS wants it — a `Blueprint` of
   nodes with a `kind` and a rationale. `/api/architect/*` returns something
   else: a PLAN of steps with temp ids, plus separate lists of the tools, agents
   and connections those steps refer to.

   Adapting one to the other here rather than serving the canvas shape directly
   is the same discipline `mock-transport.ts` already applies to runs and
   workflows: THE MOCK EMITS API SHAPES. A mock that served the view's shape
   would mean mock mode never exercises `planToBlueprint`, and the first live
   response would be the first time that mapping ran at all.

   The plan is derived from the scripted BLUEPRINT so the same description keeps
   producing the same design — a demo that generates something different each
   time is not a demo of a product.
══════════════════════════════════════════════════════════════════════════════ */

const CONNECTION_BY_PROVIDER: Record<string, { tempId: string; name: string; type: string }> = {
  postgres: { tempId: "conn_postgres", name: "Contracts database", type: "database" },
  contracts: { tempId: "conn_postgres", name: "Contracts database", type: "database" },
  slack: { tempId: "conn_slack", name: "Slack workspace", type: "slack" },
};

function providerOf(node: BlueprintNode): string | null {
  const tool = node.config.tool;
  if (typeof tool !== "string" || !tool.includes(".")) return null;
  return tool.split(".")[0];
}

function toolIdFor(node: BlueprintNode): string {
  return `tool_${node.id}`;
}

function agentIdFor(node: BlueprintNode): string {
  return `agent_${node.id}`;
}

/** The plan exactly as `WorkflowArchitectService` serialises one. */
export function mockPlan() {
  const nodes = BLUEPRINT.nodes;

  const connections = new Map<string, { tempId: string; name: string; type: string; usedBy: string[] }>();
  for (const node of nodes) {
    const provider = providerOf(node);
    const known = provider ? CONNECTION_BY_PROVIDER[provider] : undefined;
    if (!known) continue;
    const existing = connections.get(known.tempId);
    if (existing) existing.usedBy.push(toolIdFor(node));
    else connections.set(known.tempId, { ...known, usedBy: [toolIdFor(node)] });
  }

  const tools = nodes
    .filter((n) => n.kind === "tool")
    .map((n) => {
      const provider = providerOf(n);
      const known = provider ? CONNECTION_BY_PROVIDER[provider] : undefined;
      return {
        tempToolId: toolIdFor(n),
        name: String(n.config.tool ?? n.name),
        type: provider === "slack" ? "slack" : "database_read",
        connectionTempId: known?.tempId ?? null,
        description: n.rationale,
        riskLevel: provider === "slack" ? "medium" : "low",
        requiresApproval: false,
      };
    });

  const agents = nodes
    .filter((n) => n.kind === "llm" || n.kind === "agent")
    .map((n) => ({
      tempAgentId: agentIdFor(n),
      name: n.name,
      type: "llm",
      role: "Drafts customer-facing outreach from the renewal batch",
      systemPrompt: "You draft renewal outreach. Be concise and never invent contract terms.",
      allowedTempToolIds: tools.map((t) => t.tempToolId),
    }));

  return {
    workflowName: BLUEPRINT.name,
    workflowDescription:
      "Finds contracts renewing in the next 30 days, drafts outreach per account, and posts the batch for approval.",
    goalSummary:
      "A daily batch job: read renewals due inside 30 days, generate per-account outreach, and hold it at an approval gate before anything reaches Slack.",
    confidence: 0.86,
    trigger: {
      type: "cron",
      description: "Daily at 06:00 UTC",
      scheduleSuggestion: "0 6 * * *",
    },
    requiredConnections: [...connections.values()].map((c) => ({
      tempConnectionId: c.tempId,
      name: c.name,
      type: c.type,
      providerHint: c.type,
      description: `Used by ${c.usedBy.length} step${c.usedBy.length === 1 ? "" : "s"} in this workflow.`,
      requiredForSimulation: c.type === "database",
      requiredForRealExecution: true,
      usedByTempToolIds: c.usedBy,
      setupInstructions: "Bind an existing connection, or simulate it and connect real credentials later.",
      fieldsNeeded: [],
    })),
    tools,
    agents,
    workflowSteps: nodes.map((n) => ({
      tempStepId: n.id,
      name: n.name,
      nodeType: n.kind,
      toolTempId: n.kind === "tool" ? toolIdFor(n) : null,
      agentTempId: n.kind === "llm" || n.kind === "agent" ? agentIdFor(n) : null,
      rationale: n.rationale,
      config: n.config,
    })),
    edges: BLUEPRINT.edges.map((e) => ({ from: e.from, to: e.to, type: "sequence", label: e.label })),
    safetyNotes: [
      "Nothing is sent until the approval gate is cleared by a person.",
      "The Slack post is keyed on the batch date, so a retry cannot post the batch twice.",
    ],
    simulationPlan: { canSimulateWithoutConnections: false, sampleOutputsNeeded: ["renewal rows"] },
  };
}

/* ── Mutable session state ────────────────────────────────────────────────────
   Connection requirements change as the user binds and tests them, and a mock
   that ignored that would leave the Connect stage frozen on "Not connected"
   however many times it was clicked — which is precisely the stage a reviewer
   needs to see working. Scoped per session id and never persisted. */

export type RequirementStatus =
  | "missing" | "selected_existing" | "created" | "test_pending"
  | "test_failed" | "test_passed" | "simulation_placeholder";

interface MockRequirement {
  id: string;
  tempConnectionId: string;
  name: string;
  type: string;
  providerHint: string;
  description: string;
  requiredForSimulation: boolean;
  requiredForRealExecution: boolean;
  status: RequirementStatus;
  boundConnectionId: string | null;
  testStatus: string | null;
  testError: string | null;
  setupInstructions: string;
  fieldsNeeded: unknown[];
}

interface MockSession {
  id: string;
  goal: string;
  status: string;
  currentStage: string;
  requirements: MockRequirement[];
  workflowId: string | null;
  createdAt: string;
}

const SESSIONS = new Map<string, MockSession>();

export function createMockSession(id: string, goal: string): MockSession {
  const plan = mockPlan();
  const session: MockSession = {
    id,
    goal,
    status: "created",
    currentStage: "goal_capture",
    requirements: plan.requiredConnections.map((c, index) => ({
      id: `req_${index + 1}_${id.slice(0, 8)}`,
      tempConnectionId: c.tempConnectionId,
      name: c.name,
      type: c.type,
      providerHint: c.providerHint,
      description: c.description,
      requiredForSimulation: c.requiredForSimulation,
      requiredForRealExecution: c.requiredForRealExecution,
      status: "missing",
      boundConnectionId: null,
      testStatus: null,
      testError: null,
      setupInstructions: c.setupInstructions,
      fieldsNeeded: [],
    })),
    workflowId: null,
    createdAt: new Date().toISOString(),
  };
  SESSIONS.set(id, session);
  return session;
}

export function getMockSession(id: string): MockSession | undefined {
  return SESSIONS.get(id);
}

export function updateMockRequirement(
  sessionId: string,
  requirementId: string,
  patch: Partial<MockRequirement>,
): MockRequirement | undefined {
  const session = SESSIONS.get(sessionId);
  const requirement = session?.requirements.find((r) => r.id === requirementId);
  if (!requirement) return undefined;
  Object.assign(requirement, patch);
  return requirement;
}

export function requirementToApi(requirement: MockRequirement) {
  return { ...requirement };
}

/** The build reveal, in the API's `BuildStep` shape. */
export function mockBuildSteps() {
  const plan = mockPlan();
  return [
    { sequence: 1, type: "start", title: "Creating the workflow", description: plan.workflowName, status: "completed" },
    ...plan.tools.map((tool, i) => ({
      sequence: 2 + i,
      type: "tool_created",
      title: `Registered tool — ${tool.name}`,
      description: `${tool.type} · risk ${tool.riskLevel}`,
      status: "completed",
    })),
    ...plan.agents.map((agent, i) => ({
      sequence: 2 + plan.tools.length + i,
      type: "agent_created",
      title: `Registered agent — ${agent.name}`,
      description: agent.role,
      status: "completed",
    })),
    {
      sequence: 90,
      type: "validate_workflow",
      title: "Compiled and validated the graph",
      description: `${plan.workflowSteps.length} nodes, ${plan.edges.length} edges`,
      status: "completed",
    },
    { sequence: 99, type: "complete", title: "Recorded version 1", description: "Immutable, unpublished", status: "completed" },
  ];
}
