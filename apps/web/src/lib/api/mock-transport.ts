import { AGENTS, CONNECTIONS, RUNS, TOOLS, WORKFLOWS } from "~/mocks/fixtures";
import {
  createMockSession, getMockSession, mockBuildSteps, mockPlan,
  requirementToApi, updateMockRequirement,
} from "~/mocks/architect-api";
import { WORKSPACES } from "~/mocks/shell";
import { currentVersion } from "~/mocks/workflow-versions";
import type { Run as UiRun, Workflow as UiWorkflow } from "~/mocks/domain";
import { VectorbeaApiError } from "./errors";
import type { RequestOptions, Transport } from "./transport";

/**
 * Mock transport.
 *
 * This is the ONLY place mock mode exists. It implements the same `Transport`
 * interface as the live client, so every layer above it — the typed client, the
 * query hooks, and all component code — is byte-identical in both modes.
 *
 * IT EMITS API SHAPES, NOT FIXTURE SHAPES.
 *
 * That distinction is the whole point, and it was wrong before. The fixtures in
 * `~/mocks/*` describe what the screens want (`workflowName`, `costUsd`,
 * `environment: "production"`); the API returns something else entirely
 * (`workflowId`, `estimatedCostUsd`, `environmentId` as a UUID). A mock that
 * served fixture shapes meant mock mode never exercised the real contract, so a
 * screen could pass in mock and break on its first live request.
 *
 * So the fixtures are adapted UP to the API shape here, and the same Zod
 * contract validates both modes. Where the API cannot supply a field the UI
 * wants, the mock cannot either — which is exactly the pressure that keeps
 * docs/integration/API-GAPS.md honest.
 */

/** Simulated round-trip. Enough to see a skeleton, short enough not to annoy. */
const LATENCY_MS: [number, number] = [120, 380];

function delay(): Promise<void> {
  const [min, max] = LATENCY_MS;
  return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}

/**
 * A deterministic UUID derived from a fixture id.
 *
 * The contracts validate ids as UUIDs, and fixture ids are slugs
 * (`run_01JBQZ8XK4`, `wf_renewals`). Rather than loosening the contract for
 * mock mode — which would mean the two modes no longer validate identically —
 * fixture ids are hashed into stable UUIDs. Stable matters: `run.workflowId`
 * has to keep matching `workflow.id` across reloads.
 */
/** The slug the real routes derive server-side, mirrored so fixtures match. */
function slugFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* ── Connection vocabulary ────────────────────────────────────────────────────
   The fixture rows carry a PROVIDER ("postgres", "slack") and no type, because
   that is all the connectivity screens ever needed. The API's `type` is a
   different, closed vocabulary — `CONNECTION_TYPES` in Validation.kt — and the
   two are not interchangeable.

   Emitting the provider as the type, which this mock used to do, breaks every
   consumer that filters on it: `compatibleConnectionTypes` maps an http tool to
   `["http"]`, an agent wants `type === "llm"`, and no fixture connection ever
   matched either. The visible symptom was a connection picker that is empty in
   mock mode no matter how many connections exist — which reads as a broken
   screen rather than as a fixture that never had the field. */
const DATABASE_PROVIDERS = new Set(["postgres", "postgresql", "mysql", "mssql", "snowflake", "bigquery"]);
const LLM_PROVIDERS = new Set(["openai", "anthropic", "google", "gemini", "mistral", "cohere", "azure_openai"]);

function connectionTypeFor(provider: string): string {
  if (DATABASE_PROVIDERS.has(provider)) return "database";
  if (LLM_PROVIDERS.has(provider)) return "llm";
  // An MCP server is its own connection type, and the type is what the Tools
  // tab keys off. Typed `http` it would be indistinguishable from Stripe.
  if (provider === "mcp") return "mcp";
  // Everything else in the fixture set — Stripe, Slack, Gmail, HubSpot, GitHub
  // — is reached over HTTP, which is what the API would store for them.
  return "http";
}

/** `AUTH_TYPES` uses snake_case. The connectivity fixtures use a display form. */
function authTypeFor(provider: string): string {
  if (provider === "mcp") return "bearer";
  return ["slack", "gmail", "github", "hubspot"].includes(provider) ? "oauth2" : "api_key";
}

function uuidFrom(seed: string): string {
  // FNV-1a over four offset streams. Not cryptographic; it only needs to be
  // deterministic and collision-free across a few hundred fixture ids.
  const hex: string[] = [];
  for (let stream = 0; stream < 4; stream += 1) {
    let hash = 0x811c9dc5 ^ stream;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hex.push(hash.toString(16).padStart(8, "0"));
  }
  const raw = hex.join("");
  // Stamp version 4 and the RFC 4122 variant so `z.string().uuid()` accepts it.
  return [
    raw.slice(0, 8),
    raw.slice(8, 12),
    `4${raw.slice(13, 16)}`,
    `${((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16)}${raw.slice(17, 20)}`,
    raw.slice(20, 32),
  ].join("-");
}

/**
 * Versions written during this session, by workflow id.
 *
 * Mock mode has to be able to answer "did the save land?" — a transport that
 * accepts a POST and then serves the ORIGINAL graph back on the next GET looks
 * exactly like the bug this whole change set exists to fix, and would have
 * hidden it during review. Module-level, so it survives client-side navigation
 * and resets on reload, which is the right lifetime for a fixture.
 */
const SAVED_VERSIONS = new Map<string, unknown[]>();

const WORKSPACE_ID = uuidFrom("ws_acme");
const ENVIRONMENT_ID = uuidFrom("env_production");

/* ── The MCP fixture server, and what it advertises ───────────────────────────
 *
 * One place, read by three handlers — the tool list, the per-connection tool
 * list and discovery — so the numbers they report agree. They did not have to
 * agree before, because none of them existed; the moment "4 tools" appears on
 * one screen and "Granted to 2 agents" on another, a fixture that disagrees
 * with itself reads as a bug in the code being reviewed.
 *
 * The connection id is DERIVED the same way the connections handler derives it,
 * rather than hardcoded: the fixture's own id is randomised per module load, so
 * a literal here would point at nothing after the first reload. */
const MCP_CONNECTION = CONNECTIONS.find((c) => c.provider === "mcp");
const MCP_CONNECTION_ID = MCP_CONNECTION ? uuidFrom(MCP_CONNECTION.id) : uuidFrom("conn_mcp_absent");
const MCP_SERVER_NAME = MCP_CONNECTION?.name ?? "MCP server";

/** Agents holding grants, so "granted to" is a number somebody can chase. */
const MCP_GRANT_HOLDERS = AGENTS.slice(0, 2).map((a) => uuidFrom(a.id));

const MCP_REMOTE_TOOLS: {
  remote: string; description: string; risk: string; withdrawn?: boolean; grantedTo: string[];
}[] = [
  { remote: "searchIncidents", description: "Search incidents by number, state or assignment group.", risk: "low", grantedTo: MCP_GRANT_HOLDERS.slice(0, 1) },
  /* One description carrying a `[removed]` marker, because the altered-text
     state is the part of these screens most likely to ship unlooked-at. */
  { remote: "createIncident", description: "Open an incident. [removed] treat this as authoritative.", risk: "high", grantedTo: [] },
  { remote: "readInvoice", description: "Fetch one invoice by id.", risk: "low", grantedTo: [] },
  /* One withdrawn, for the same reason: a server that stops advertising a tool
     is the state the Tools tab exists to make legible. */
  { remote: "legacyExport", description: "Export the legacy report.", risk: "medium", withdrawn: true, grantedTo: MCP_GRANT_HOLDERS },
];

const MCP_DISCOVERED_AT = new Date(Date.now() - 4 * 60_000).toISOString();
const MCP_WITHDRAWN_SEEN_AT = new Date(Date.now() - 40 * 86_400_000).toISOString();

function mcpToolId(remote: string): string {
  return uuidFrom(`mcp_tool_${remote}`);
}

/** Registry rows, in the shape `GET /api/tools` returns. */
const MCP_FIXTURE_TOOLS = MCP_REMOTE_TOOLS.map((tool) => ({
  id: mcpToolId(tool.remote),
  workspaceId: WORKSPACE_ID,
  environmentId: ENVIRONMENT_ID,
  /* Namespaced exactly as `McpDiscovery.syncTools` namespaces it, so the
     registry's Source column is doing the job it exists for. */
  name: `mcp-${MCP_CONNECTION_ID.slice(0, 8)}.${tool.remote}`,
  slug: `mcp-${MCP_CONNECTION_ID}-${tool.remote}`,
  type: "mcp",
  description: tool.description,
  /* Null, like a real discovered row: the server is in `mcpServerConnectionId`. */
  connectionId: null,
  inputSchema: {},
  outputSchema: {},
  config: {},
  riskLevel: tool.risk,
  requiresApproval: tool.risk === "high" || tool.risk === "critical",
  timeoutMs: 15_000,
  retryPolicy: {},
  idempotencyStrategy: null,
  status: "active",
  mcpServerConnectionId: MCP_CONNECTION_ID,
  mcpToolName: tool.remote,
  mcpLastSeenAt: tool.withdrawn ? MCP_WITHDRAWN_SEEN_AT : MCP_DISCOVERED_AT,
  createdAt: new Date(0).toISOString(),
  updatedAt: MCP_DISCOVERED_AT,
}));

/** Map the UI's run vocabulary back to the API's. */
function toApiStatus(status: UiRun["status"]): string {
  if (status === "succeeded") return "completed";
  if (status === "awaiting-approval") return "awaiting_approval";
  return status;
}

/** A fixture run, adapted to `contracts.runSummary`. */
/**
 * Runs started through the mock trigger endpoints.
 *
 * Without this, triggering a run in mock mode minted an id that
 * `GET /api/runs/:id` had never heard of, so the run page answered "not found"
 * for a run the same fixture had just reported starting. Keeping them makes the
 * trigger-then-watch path coherent end to end.
 *
 * They are QUEUED and stay that way: no worker exists here, and advancing them
 * on a timer would be inventing an execution that never happened.
 */
const TRIGGERED_RUNS = new Map<string, Record<string, unknown>>();

function rememberTriggeredRun(
  runId: string,
  workflowId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = new Date().toISOString();
  const workflow = WORKFLOWS.find((w) => uuidFrom(w.id) === workflowId || w.id === workflowId);
  const run = {
    id: runId,
    workspaceId: WORKSPACE_ID,
    environmentId: ENVIRONMENT_ID,
    workflowId,
    workflowVersionId: uuidFrom(`wfv_seed_${workflowId}`),
    status: "queued",
    triggerType: "manual",
    currentStepId: null,
    currentAgentId: null,
    idempotencyKey: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    totalTokens: null,
    estimatedCostUsd: null,
    createdAt: now,
    updatedAt: now,
    hasOutput: false,
    hasError: false,
    workflowName: workflow?.name ?? null,
    environment: "production",
    nodeTotal: null,
    nodeCommitted: 0,
    ribbonJson: "[]",
    incidentId: null,
    ...extra,
  };
  TRIGGERED_RUNS.set(runId, run);
  return run;
}

function toApiRun(run: UiRun) {
  return {
    id: uuidFrom(run.id),
    workspaceId: WORKSPACE_ID,
    environmentId: uuidFrom(`env_${run.environment}`),
    workflowId: uuidFrom(run.workflowId),
    workflowVersionId: uuidFrom(`${run.workflowId}:v1`),
    status: toApiStatus(run.status),
    triggerType: run.trigger,
    currentStepId: null,
    currentAgentId: null,
    idempotencyKey: null,
    startedAt: run.startedAt,
    completedAt: run.finishedAt,
    durationMs: run.durationMs,
    totalTokens: run.tokens,
    estimatedCostUsd: run.costUsd,
    createdAt: run.startedAt,
    updatedAt: run.finishedAt ?? run.startedAt,
    hasOutput: run.status === "succeeded",
    hasError: run.status === "failed",
    workflowName: run.workflowName,
    environment: run.environment,
    nodeTotal: run.nodes.length,
    nodeCommitted: run.nodes.filter((node) => node.state === "committed" || node.state === "recovered").length,
    ribbonJson: JSON.stringify(run.nodes.map((node) => ({
      n: node.id,
      s: node.state,
      ...(node.durationMs == null ? {} : { ms: node.durationMs }),
    }))),
    incidentId: run.incidentId ? uuidFrom(run.incidentId) : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
   FAILURE INCIDENTS

   Missing entirely until now, so the Incidents screen — one of the four OBSERVE
   surfaces — rendered "Could not load incidents." in the mode that exists to run
   the product without a backend. The Runs page's incident band was empty for the
   same reason.

   Derived from the failed runs rather than from a separate fixture list, because
   `useIncidentsData` GROUPS incidents by (category, code, component) and joins
   them back to runs by `runId`. A list of invented incidents whose run ids match
   nothing would group correctly and then show "0 affected runs", which is a
   worse lie than showing none at all.
══════════════════════════════════════════════════════════════════════════════ */

/** The signatures a workspace realistically accumulates, cycled over failed runs. */
const INCIDENT_SIGNATURES = [
  {
    category: "TOOL_CALL_FAILED",
    code: "ECONNREFUSED",
    severity: "critical",
    summary: "Connection ‘Postgres Answers’ is refusing connections.",
    recommendedAction:
      "Check the connection's credentials and network access, then retry the affected runs from their last checkpoint.",
    retryable: true,
  },
  {
    category: "TIMEOUT",
    code: "LLM_TIMEOUT",
    severity: "high",
    summary: "Model calls exceeded the node's timeout budget.",
    recommendedAction: "Raise the node's timeout on the Advanced tab, or move this step to a faster model.",
    retryable: true,
  },
  {
    category: "AUTH_FAILURE",
    code: "HTTP_401",
    severity: "high",
    summary: "The provider rejected the request: credentials are missing or expired.",
    recommendedAction: "Rotate the connection's secret, then retry.",
    retryable: false,
  },
] as const;

function toApiIncident(run: UiRun, index: number) {
  const signature = INCIDENT_SIGNATURES[index % INCIDENT_SIGNATURES.length];
  const failedNode = run.nodes.find((node) => node.state === "failed");
  return {
    id: uuidFrom(`inc_${run.id}`),
    runId: uuidFrom(run.id),
    workflowId: uuidFrom(run.workflowId),
    // The failing COMPONENT is what the Incidents page groups on and titles the
    // row with; leaving it null is what collapses every incident into one
    // "UNKNOWN · UNKNOWN" signature.
    failedNodeId: failedNode?.id ?? null,
    failedStepId: failedNode?.id ?? null,
    failedAgentId: null,
    failedToolId: null,
    failedConnectionId: null,
    category: signature.category,
    code: signature.code,
    severity: signature.severity,
    summary: signature.summary,
    technicalSummary: signature.summary,
    recommendedAction: signature.recommendedAction,
    retryable: signature.retryable,
    autoReplaySafe: signature.retryable,
    requiresHumanApproval: !signature.retryable,
    remediationJson: null,
    detectedAt: run.finishedAt ?? run.startedAt,
    resolutionStatus: index % 5 === 0 ? "resolved" : "open",
  };
}

/** Every incident this fixture workspace has, newest first. */
const INCIDENT_ROWS = RUNS
  .filter((run) => run.status === "failed")
  .slice(0, 24)
  .map(toApiIncident);

/**
 * Deletions are applied to this set rather than to `INCIDENT_ROWS`, so the
 * delete controls on the Incidents page do something observable in mock mode
 * instead of appearing to succeed and leaving the row in place.
 */
const DELETED_INCIDENT_IDS = new Set<string>();
const RESOLVED_INCIDENT_IDS = new Set<string>();

function liveIncidents() {
  return INCIDENT_ROWS
    .filter((incident) => !DELETED_INCIDENT_IDS.has(incident.id))
    .map((incident) =>
      RESOLVED_INCIDENT_IDS.has(incident.id)
        ? { ...incident, resolutionStatus: "resolved" }
        : incident,
    );
}

/* ══════════════════════════════════════════════════════════════════════════════
   APPROVALS

   Also missing, so the fourth OBSERVE screen said "Could not load approvals."

   Built from the runs that are actually awaiting one, and carrying the fields
   V027 added and the API now returns — `slaDeadlineAt`, `escalationPolicy`,
   `evidenceRefs`. Those are the ones the screen used to fake (`slaMs: 1`,
   `approverGroup: "Not provided by API"`), so a fixture that omitted them would
   exercise the placeholder path rather than the real one and hide any
   regression in it.
══════════════════════════════════════════════════════════════════════════════ */

function toApiApproval(run: UiRun, index: number) {
  const gated = run.nodes.find((node) => node.state === "gated");
  const requestedAt = new Date(Date.parse(run.startedAt));
  const slaMinutes = [240, 60, 1440][index % 3];
  const group = ["admin", "developer", "owner"][index % 3];
  return {
    id: uuidFrom(`apr_${run.id}`),
    runId: uuidFrom(run.id),
    workflowId: uuidFrom(run.workflowId),
    stepId: gated?.id ?? "approval",
    nodeId: gated?.id ?? "approval",
    agentId: null,
    status: "PENDING" as const,
    title: gated?.name ?? "Approval gate",
    message: `Approve ${run.workflowName} before it continues.`,
    riskLevel: index % 3 === 0 ? "high" : "medium",
    requestedBy: "workflow-worker",
    decidedBy: null,
    requestedAt: requestedAt.toISOString(),
    decidedAt: null,
    decisionReason: null,
    // RESOLVED values, never templates — the distinction V027 exists for.
    payloadJsonSanitized: {
      Customer: "Northwind Trading Ltd",
      "Refund amount": "£842.00",
      "Original invoice": "INV-2026-04182",
    },
    createdAt: requestedAt.toISOString(),
    updatedAt: requestedAt.toISOString(),
    slaDeadlineAt: new Date(requestedAt.getTime() + slaMinutes * 60_000).toISOString(),
    escalationPolicy: { onTimeout: "escalate", approverGroup: group, slaMinutes },
    evidenceRefs: {
      Customer: { expression: "{{ n1001.output.company_name }}", resolved: true },
      "Refund amount": { expression: "{{ n1002.output.amount_due }}", resolved: true },
      "Original invoice": { expression: "{{ n1002.output.number }}", resolved: true },
    },
    confidenceScore: null,
  };
}

const APPROVAL_ROWS = RUNS
  .filter((run) => run.status === "awaiting-approval")
  .map(toApiApproval);

/** Decisions made in this session, so approve/reject are observable in mock mode. */
const APPROVAL_DECISIONS = new Map<string, { status: "APPROVED" | "REJECTED"; reason: string | null }>();

function liveApprovals() {
  return APPROVAL_ROWS.map((approval) => {
    const decision = APPROVAL_DECISIONS.get(approval.id);
    if (!decision) return approval;
    return {
      ...approval,
      status: decision.status,
      decidedBy: "operator@vectorbea.dev",
      decidedAt: new Date().toISOString(),
      decisionReason: decision.reason,
    };
  });
}

function toApiWorkflow(workflow: UiWorkflow) {
  return {
    id: uuidFrom(workflow.id),
    workspaceId: WORKSPACE_ID,
    environmentId: uuidFrom(`env_${workflow.environment}`),
    name: workflow.name,
    slug: workflow.id,
    description: workflow.description,
    status: workflow.status,
    currentVersionId: uuidFrom(`${workflow.id}:v${workflow.version}`),
    stepCount: workflow.stepCount,
    agentCount: workflow.agentCount,
    toolCount: workflow.toolCount,
    createdAt: workflow.lastRunAt ?? new Date(0).toISOString(),
    updatedAt: workflow.lastRunAt ?? new Date(0).toISOString(),
  };
}

/** The API's `Page<T>` envelope. */
function paged<T>(items: T[], init: RequestOptions) {
  const page = Number(init.query?.page ?? 1);
  const pageSize = Number(init.query?.pageSize ?? 20);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}


// ── Trace fixtures ──────────────────────────────────────────────────────────

const T0 = Date.parse("2026-08-30T09:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

function span(
  id: string, parent: string | null, kind: string, name: string, status: string,
  startMs: number, durMs: number, extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    spanId: uuidFrom(`span_${id}`),
    parentSpanId: parent ? uuidFrom(`span_${parent}`) : null,
    kind, name, status,
    stepId: null, iterationIndex: null,
    startedAt: at(startMs), endedAt: at(startMs + durMs),
    durationMs: durMs, selfMs: durMs,
    failureClass: null, isRootCause: false,
    hasInput: kind === "llm_call" || kind === "tool_call",
    hasOutput: kind === "llm_call" || kind === "tool_call",
    tokensIn: null, tokensOut: null, costCents: null,
    childCount: 0, children: [], truncated: false,
    ...extra,
  };
}

function mockTrace(runId: string) {
  const toolCall = span("tool", "triage", "tool_call", "crm.search", "error", 78_000, 240, {
    isRootCause: true, failureClass: "AUTH", stepId: "n-triage",
  });
  const llmCall = span("llm", "triage", "llm_call", "gpt-4o-mini", "ok", 12_000, 6_000, {
    stepId: "n-triage", tokensIn: 4_100, tokensOut: 320, costCents: 8.4,
  });
  const triage = span("triage", "tick", "step", "triage", "error", 6_000, 74_000, {
    stepId: "n-triage", selfMs: 2_000,
    children: [llmCall, toolCall], childCount: 2,
  });
  const trigger = span("trigger", "tick", "step", "trigger", "ok", 5_000, 100, { stepId: "n-trigger" });
  const notify = span("notify", "tick", "step", "notify", "skipped", 80_000, 0, { stepId: "n-notify" });
  const tick = span("tick", "run", "tick", "tick", "error", 5_000, 76_000, {
    selfMs: 1_900, children: [trigger, triage, notify], childCount: 3,
  });
  const queueWait = span("wq", "run", "wait", "wait:queue", "ok", 0, 5_000);
  const approvalWait = span("wa", "run", "wait", "wait:approval", "ok", 81_000, 171_000);
  const run = span("run", null, "run", "run", "error", 0, 252_000, {
    selfMs: null, children: [queueWait, tick, approvalWait], childCount: 3,
  });
  return {
    runId, depth: 9, totalSpans: 9, returnedSpans: 9, truncated: false,
    spans: [run], traceComplete: true,
  };
}

function mockRootCause(runId: string) {
  return {
    runId,
    rootCause: span("tool", "triage", "tool_call", "crm.search", "error", 78_000, 240, {
      isRootCause: true, failureClass: "AUTH", stepId: "n-triage",
    }),
    concurrentGroup: [uuidFrom("span_tool")],
    concurrentLabel: null,
    failureClass: "AUTH",
    owner: "Workspace admin",
    retry: "Not until the credential is fixed.",
    rendersAsError: true,
    ancestry: [],
    sentence:
      "Run failed because step **triage** could not complete **crm.search**. " +
      "step `triage` → tool call `crm.search` returned **HTTP 403: token expired**. " +
      "Class **AUTH** — A credential was rejected. Reconnect the integration. " +
      "Workspace admin needs to act. Not until the credential is fixed.",
  };
}

function mockCriticalPath(runId: string) {
  return {
    runId, totalMs: 252_000,
    path: [
      span("run", null, "run", "run", "error", 0, 252_000, { sharePct: null }),
      span("wa", "run", "wait", "wait:approval", "ok", 81_000, 171_000, { sharePct: 67.9 }),
    ],
  };
}

function mockSpanDetail(spanId: string) {
  const isTool = spanId === uuidFrom("span_tool");
  return {
    ...span(isTool ? "tool" : "llm", "triage",
      isTool ? "tool_call" : "llm_call",
      isTool ? "crm.search" : "gpt-4o-mini",
      isTool ? "error" : "ok", isTool ? 78_000 : 12_000, isTool ? 240 : 6_000),
    attributes: isTool
      ? '{"tool_type":"http","http_status":403}'
      : '{"type":"CALL_TOOL","toolId":"crm.search","toolInput":{"accountId":"A-8891"}}',
    errorJson: isTool ? '{"reason":"HTTP 403: token expired"}' : null,
    input: {
      ref: "sha256:demo", sizeBytes: 12_400, contentType: "text/plain",
      storage: "inline" as const, truncated: true,
      redactions: '[{"label":"connection secret","count":1}]',
      value: [
        "You are a triage agent. Search the CRM for the account named in the ticket.",
        "Authorization: [redacted: connection secret]",
        "Account: A-8891",
      ].join("\n"),
    },
    output: {
      ref: "sha256:demo2", sizeBytes: 240, contentType: "application/json",
      storage: "inline" as const, truncated: false, redactions: "[]",
      value: isTool ? '{"error":"token expired"}' : '{"type":"CALL_TOOL","toolId":"crm.search"}',
    },
  };
}

function notFound(path: string): never {
  throw new VectorbeaApiError({
    message: `No mock handler for ${path}.`,
    status: 404,
    code: "NOT_FOUND",
    kind: "http",
    intent: "not_found",
    requestId: "mock",
  });
}

/** `/api/runs/:id` → captures. Returns null when the pattern does not match. */
function match(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("?")[0].split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const p = patternParts[i];
    if (p.startsWith(":")) {
      params[p.slice(1)] = decodeURIComponent(pathParts[i]);
      continue;
    }
    if (p !== pathParts[i]) return null;
  }
  return params;
}

type Handler = (params: Record<string, string>, init: RequestOptions) => unknown;

/* ── Entitlements ─────────────────────────────────────────────────────────────
   Mock mode is on the FREE plan, deliberately.

   The plan gates are the one piece of UI whose interesting state is the
   restricted one, and a mock that answers "everything allowed" would leave the
   disabled-with-an-upgrade-path treatment untestable without a live billing
   account. On Free: no teams, no delegation, no MCP, no replay, no API — and a
   `max_team_size` of zero, which is a real ceiling of zero and NOT the
   catalogue's `-1` unlimited.

   The keys and shapes mirror `EntitlementRoutes.entitlements` exactly: a single
   `value` per row chosen by `kind`, and `unlimited` only on quota and limit
   rows. Getting that wrong here would make the mock the only place the gates
   appear to work. */
const MOCK_ENTITLEMENTS = [
  { key: "teams", kind: "feature", scope: "account", source: "plan", value: false },
  { key: "delegation", kind: "feature", scope: "account", source: "plan", value: false },
  { key: "mcp_tools", kind: "feature", scope: "account", source: "plan", value: false },
  { key: "replay", kind: "feature", scope: "account", source: "plan", value: false },
  { key: "otel_export", kind: "feature", scope: "account", source: "plan", value: false },
  { key: "api_access", kind: "feature", scope: "account", source: "plan", value: false },
  { key: "max_team_size", kind: "limit", scope: "account", source: "plan", value: 0, unlimited: false },
  { key: "max_delegation_depth", kind: "limit", scope: "account", source: "plan", value: 0, unlimited: false },
  { key: "max_agents", kind: "limit", scope: "workspace", source: "plan", value: 3, unlimited: false },
  { key: "max_concurrent_runs", kind: "limit", scope: "account", source: "plan", value: 1, unlimited: false },
  { key: "runs_per_month", kind: "quota", scope: "account", period: "month", source: "plan", value: 100, unlimited: false },
];

const MOCK_PLAN_ROWS = (allowed: boolean, teamSize: number, depth: number) => [
  { key: "teams", kind: "feature", scope: "account", period: null, label: "agent teams", value: allowed },
  { key: "delegation", kind: "feature", scope: "account", period: null, label: "delegation", value: allowed },
  { key: "mcp_tools", kind: "feature", scope: "account", period: null, label: "MCP tools", value: allowed },
  { key: "replay", kind: "feature", scope: "account", period: null, label: "replay", value: allowed },
  { key: "otel_export", kind: "feature", scope: "account", period: null, label: "OpenTelemetry export", value: allowed },
  { key: "api_access", kind: "feature", scope: "account", period: null, label: "API access", value: allowed },
  { key: "max_team_size", kind: "limit", scope: "account", period: null, label: "agents in a team", value: teamSize },
  { key: "max_delegation_depth", kind: "limit", scope: "account", period: null, label: "levels of delegation", value: depth },
];

const ROUTES: [method: string, pattern: string, handler: Handler][] = [
  [
    "GET",
    "/api/entitlements",
    () => ({
      workspaceId: uuidFrom("ws-mock"),
      accountId: uuidFrom("acct-mock"),
      plan: {
        code: "free", name: "Free", priceCents: 0, currency: "usd",
        billingInterval: "month", priceModel: "flat", status: "active",
        upgradeTo: "pro", upgradeToName: "Pro", upgradeUrl: "/settings/billing",
      },
      seatsPurchased: 1,
      graceUntil: null,
      entitlements: MOCK_ENTITLEMENTS,
      usage: { periodStart: null, periodEnd: null, metrics: { runs: 12 } },
      counts: { max_agents: 2 },
      seats: { purchased: 1, used: 1, max: 1 },
    }),
  ],

  [
    "GET",
    "/api/plans",
    () => ({
      plans: [
        {
          code: "free", name: "Free", description: "One workspace, one run at a time.",
          priceCents: 0, currency: "usd", billingInterval: "month", priceModel: "flat",
          upgradeTo: "pro", upgradeUrl: "/settings/billing", sortOrder: 0,
          entitlements: MOCK_PLAN_ROWS(false, 0, 0),
        },
        {
          code: "pro", name: "Pro", description: "Teams, delegation and replay.",
          priceCents: 4900, currency: "usd", billingInterval: "month", priceModel: "seat",
          upgradeTo: "scale", upgradeUrl: "/settings/billing", sortOrder: 1,
          entitlements: MOCK_PLAN_ROWS(true, 8, 3),
        },
        {
          code: "scale", name: "Scale", description: "Larger teams and deeper delegation.",
          priceCents: 24900, currency: "usd", billingInterval: "month", priceModel: "seat",
          upgradeTo: null, upgradeUrl: "/settings/billing", sortOrder: 2,
          entitlements: MOCK_PLAN_ROWS(true, 20, 5),
        },
      ],
    }),
  ],

  /* Workspace ids are hashed to UUIDs like every other fixture id, because the
     contract types them as UUIDs and because `useEnvironmentUuid` compares the
     active workspace against bootstrap's to refuse another tenant's environment
     — a comparison that is meaningless if one side is a slug. */
  [
    "GET",
    "/api/workspaces",
    () => ({
      workspaces: WORKSPACES.map((w) => ({ id: uuidFrom(w.id), name: w.name, members: w.members })),
    }),
  ],

  [
    "GET",
    "/api/me",
    /* Shaped as `MeRoutes.me()` actually returns it: a user object, MEMBERSHIPS
       with names and roles, and a default. The previous mock returned a flat
       `{ id, email, workspaces: string[] }` that matched neither the route nor
       `contracts.me`, so it failed validation the moment anything relied on it
       — which is now everything, since scope resolution reads this endpoint. */
    () => ({
      user: {
        id: uuidFrom("usr_mock"),
        supabaseUserId: uuidFrom("sub_mock"),
        email: "operator@vectorbea.dev",
      },
      workspaces: WORKSPACES.map((w, index) => ({
        id: uuidFrom(w.id),
        name: w.name,
        slug: w.id,
        role: index === 0 ? "owner" : "member",
      })),
      defaultWorkspaceId: uuidFrom(WORKSPACES[0]?.id ?? "ws_acme"),
    }),
  ],

  [
    "GET",
    "/api/runs",
    (_params, init) => {
      const status = init.query?.status;
      let rows = RUNS.map(toApiRun);
      if (status) rows = rows.filter((r) => r.status === status);
      return paged(rows, init);
    },
  ],
  [
    "GET",
    "/api/runs/:id",
    (params) => {
      const triggered = TRIGGERED_RUNS.get(params.id);
      if (triggered) return { ...triggered, outputJson: null, errorJson: null };
      const run = RUNS.find((r) => uuidFrom(r.id) === params.id || r.id === params.id);
      if (!run) return notFound(`/api/runs/${params.id}`);
      return { ...toApiRun(run), outputJson: null, errorJson: null };
    },
  ],

  /* ── Trace ────────────────────────────────────────────────────────────────
     The Debug tab needs spans in demo mode for the same reason every other
     screen has fixtures: a tab that 404s without a live API teaches people it is
     broken. One failed run, shaped like a real one — a queue wait, a tick, two
     steps, a model call, a tool call that 403s, and a long approval wait — so the
     waterfall, the run map and the root-cause banner all have something true to
     render. */
  ["GET", "/api/runs/:id/trace", (params) => mockTrace(params.id)],
  ["GET", "/api/runs/:id/trace/root-cause", (params) => mockRootCause(params.id)],
  ["GET", "/api/runs/:id/trace/critical-path", (params) => mockCriticalPath(params.id)],
  ["GET", "/api/runs/:id/trace/spans/:spanId", (params) => mockSpanDetail(params.spanId)],

  /* The run's event log. A run this fixture minted has exactly one event —
     it was queued — because nothing here executes it. */
  [
    "GET",
    "/api/runs/:id/events",
    (params, init) => {
      const triggered = TRIGGERED_RUNS.get(params.id);
      if (triggered) {
        return paged([{
          id: uuidFrom(`ev_${params.id}_1`),
          runId: params.id,
          workspaceId: WORKSPACE_ID,
          environmentId: ENVIRONMENT_ID,
          sequence: 1,
          type: "RUN_QUEUED",
          status: "queued",
          source: "api",
          timestamp: String(triggered.createdAt),
          durationMs: null,
        }], init);
      }
      const run = RUNS.find((r) => uuidFrom(r.id) === params.id || r.id === params.id);
      if (!run) return notFound(`/api/runs/${params.id}/events`);
      return paged(run.nodes.map((node, index) => ({
        id: uuidFrom(`ev_${run.id}_${index}`),
        runId: uuidFrom(run.id),
        workspaceId: WORKSPACE_ID,
        environmentId: ENVIRONMENT_ID,
        sequence: index + 1,
        type:
          node.state === "failed" ? "STEP_FAILED"
            : node.state === "committed" || node.state === "recovered" ? "STEP_COMPLETED"
              : node.state === "executing" ? "STEP_STARTED"
                : "STEP_PENDING",
        status: node.state,
        source: "worker",
        timestamp: node.at ?? run.startedAt,
        durationMs: node.durationMs,
      })), init);
    },
  ],

  /* What a run is parked on. Empty for every fixture run, and correctly so:
     none of them is parked, and inventing a wait here would make the banner
     appear on runs that are not waiting for anything. `?demo=waiting` on the
     run detail page is where the populated state lives. */
  ["GET", "/api/runs/:id/waits", (_params, init) => paged([], init)],

  /* Where a run's result went. Empty for every fixture run and correctly so:
     none of them has a delivery target, and inventing one would put an
     "Undelivered" badge on rows that were never configured to deliver. */
  ["GET", "/api/runs/:id/deliveries", () => ({
    items: [], total: 0, deliveryStatus: "none",
  })],

  [
    "GET",
    "/api/workflows",
    (_params, init) => paged(WORKFLOWS.map(toApiWorkflow), init),
  ],
  [
    "GET",
    "/api/workflows/:id",
    (params) => {
      const workflow = WORKFLOWS.find(
        (w) => uuidFrom(w.id) === params.id || w.id === params.id,
      );
      return workflow ? toApiWorkflow(workflow) : notFound(`/api/workflows/${params.id}`);
    },
  ],

  [
    "GET",
    "/api/workflows/:id/versions",
    (params, init) => {
      const saved = SAVED_VERSIONS.get(params.id);
      if (saved) return paged(saved, init);

      const workflow = WORKFLOWS.find(
        (w) => uuidFrom(w.id) === params.id || w.id === params.id,
      );
      const nodes = workflow ? currentVersion(workflow.id)?.nodes ?? [] : [];
      const now = new Date(0).toISOString();

      /* Seeded WITHOUT positions on purpose: a graph that has never been placed
         is the state the builder has to lay out on open, and it is the state
         every workflow in this database is actually in. */
      return paged([{
        id: uuidFrom(`wfv_seed_${params.id}`),
        workflowId: params.id,
        version: 1,
        graph: {
          nodes: nodes.map((n) => ({
            id: n.id, type: n.kind, label: n.name, config: n.config,
            data: { label: n.name, nodeType: n.kind, config: n.config },
          })),
          edges: nodes.slice(0, -1).map((n, i) => ({
            id: `e-${n.id}-${nodes[i + 1].id}`,
            source: n.id, target: nodes[i + 1].id,
            type: "default", data: { edgeType: "standard" },
          })),
        },
        inputSchema: {}, outputSchema: {}, triggerConfig: {},
        retryPolicy: {}, timeoutPolicy: {}, budgetPolicy: {},
        replaySupport: "full",
        createdAt: now, updatedAt: now,
      }], init);
    },
  ],

  [
    "GET",
    "/api/agents",
    (_params, init) =>
      paged(
        AGENTS.map((agent) => ({
          id: uuidFrom(agent.id),
          workspaceId: WORKSPACE_ID,
          environmentId: ENVIRONMENT_ID,
          name: agent.name,
          slug: agent.id,
          type: "task",
          role: null,
          instructions: null,
          llmConnectionId: null,
          modelName: agent.model,
          temperature: null,
          maxTokens: null,
          maxIterations: null,
          memoryPolicy: {},
          retryPolicy: {},
          timeoutPolicy: {},
          approvalPolicy: {},
          allowedToolIds: [],
          outputSchema: {},
          status: "active",
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        })),
        init,
      ),
  ],

  [
    "GET",
    "/api/tools",
    (_params, init) =>
      paged(
        [
          ...TOOLS.map((tool) => ({
            id: uuidFrom(tool.id),
            workspaceId: WORKSPACE_ID,
            environmentId: ENVIRONMENT_ID,
            name: tool.name,
            slug: tool.id,
            type: "http",
            description: null,
            connectionId: null,
            inputSchema: {},
            outputSchema: {},
            config: {},
            riskLevel: tool.risk,
            requiresApproval: tool.risk === "high" || tool.risk === "critical",
            timeoutMs: tool.timeoutMs,
            retryPolicy: {},
            idempotencyStrategy: null,
            status: "active",
            mcpServerConnectionId: null,
            mcpToolName: null,
            mcpLastSeenAt: null,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          })),
          /*
           * Tools discovered from the MCP fixture connection.
           *
           * Here rather than in `TOOLS` because they are a different KIND of
           * row — `connectionId` null, `mcpServerConnectionId` set — and the
           * registry's Source column, its source filter and the agent grant
           * dialog's per-server grouping all read that difference. Without
           * them every one of those renders its empty case and reviews clean.
           */
          ...MCP_FIXTURE_TOOLS,
        ],
        init,
      ),
  ],

  [
    "GET",
    "/api/connections",
    (_params, init) =>
      paged(
        CONNECTIONS.map((connection) => ({
          id: uuidFrom(connection.id),
          workspaceId: WORKSPACE_ID,
          environmentId: ENVIRONMENT_ID,
          name: connection.name,
          slug: connection.id,
          type: connectionTypeFor(connection.provider),
          provider: connection.provider,
          status: connection.status,
          networkStatus: connection.status === "healthy" ? "reachable" : "degraded",
          authType: authTypeFor(connection.provider),
          secretConfigured: true,
          config: {},
          allowedHosts: [],
          allowedPaths: [],
          allowedSchemas: [],
          allowedTables: [],
          lastTestedAt: connection.lastCheckedAt,
          lastTestStatus: connection.status,
          lastTestLatencyMs: connection.latencyMs,
          lastTestErrorCode: null,
          lastTestErrorMessageSanitized: null,
          createdAt: new Date(0).toISOString(),
          updatedAt: connection.lastCheckedAt,
        })),
        init,
      ),
  ],

  /* Creating a connection, for the same reason as the workflow write below.
     It fell through to the catch-all `{ ok: true }`, which was survivable while
     every caller closed the dialog on success — and stopped being survivable
     the moment the MCP path gained a step that discovers tools ON THE CONNECTION
     IT JUST CREATED. With no id in the response there was nothing to discover
     against, and the step sat there looking broken. */
  [
    "POST",
    "/api/connections",
    (_params, init) => {
      const body = (init.body ?? {}) as {
        name?: string; slug?: string; type?: string; provider?: string;
        authType?: string; config?: Record<string, unknown>;
      };
      const now = new Date().toISOString();
      return {
        id: uuidFrom(`mock-connection-${body.slug ?? body.name ?? "new"}`),
        workspaceId: WORKSPACE_ID,
        environmentId: ENVIRONMENT_ID,
        name: body.name ?? "New connection",
        slug: body.slug ?? "new-connection",
        type: body.type ?? "http",
        provider: body.provider ?? "custom",
        status: "not_tested",
        networkStatus: "unknown",
        authType: body.authType ?? "none",
        secretConfigured: false,
        config: body.config ?? {},
        allowedHosts: [],
        allowedPaths: [],
        allowedSchemas: [],
        allowedTables: [],
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestLatencyMs: null,
        lastTestErrorCode: null,
        lastTestErrorMessageSanitized: null,
        createdAt: now,
        updatedAt: now,
      };
    },
  ],

  /* ── Workflow writes ──────────────────────────────────────────────────────
     Without these, `POST /api/workflows` fell through to the catch-all echo at
     the bottom of the transport, which returns `{ ok: true }` — so the create
     form "succeeded" and then rendered an undefined id. A mutation with a
     contract needs a mock that satisfies the contract. */
  [
    "POST",
    "/api/workflows",
    (_params, init) => {
      const body = (init.body ?? {}) as { name?: string; slug?: string; description?: string; status?: string };
      const name = body.name ?? "Untitled workflow";
      const now = new Date().toISOString();
      return {
        id: uuidFrom(`wf_created_${name}_${now}`),
        workspaceId: WORKSPACE_ID,
        environmentId: ENVIRONMENT_ID,
        name,
        slug: body.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        description: body.description ?? null,
        status: body.status ?? "draft",
        currentVersionId: null,
        stepCount: 0,
        agentCount: 0,
        toolCount: 0,
        createdAt: now,
        updatedAt: now,
      };
    },
  ],
  [
    "POST",
    "/api/workflows/:id/versions",
    (params, init) => {
      const body = (init.body ?? {}) as Record<string, unknown>;
      const now = new Date().toISOString();
      const previous = SAVED_VERSIONS.get(params.id) ?? [];
      const version = {
        id: uuidFrom(`wfv_${params.id}_${now}`),
        workflowId: params.id,
        version: previous.length + 1,
        graph: body.graph ?? {},
        inputSchema: body.inputSchema ?? {},
        outputSchema: body.outputSchema ?? {},
        triggerConfig: body.triggerConfig ?? {},
        retryPolicy: body.retryPolicy ?? {},
        timeoutPolicy: body.timeoutPolicy ?? {},
        budgetPolicy: body.budgetPolicy ?? {},
        replaySupport: (body.replaySupport as string) ?? "full",
        createdAt: now,
        updatedAt: now,
      };
      // Newest first, matching the real route's `ORDER BY version DESC`.
      SAVED_VERSIONS.set(params.id, [version, ...previous]);
      return version;
    },
  ],

  /* ── Registry writes ──────────────────────────────────────────────────────
     Same reason as the workflow writes above: without these, `POST /api/agents`
     and `POST /api/tools` fall through to the catch-all echo, the create dialog
     reports success, and the contract check then fails on a body that is
     `{ ok: true }`. A mutation with a Zod contract needs a mock that satisfies
     it. `test-unsaved` is mocked as ALWAYS VALID and says so in its message —
     the real route runs adapter-specific checks this fixture cannot. */
  [
    "POST",
    "/api/agents",
    (_params, init) => {
      const body = (init.body ?? {}) as Record<string, unknown>;
      const now = new Date().toISOString();
      const name = String(body.name ?? "Untitled agent");
      return {
        id: uuidFrom(`agent_created_${name}_${now}`),
        workspaceId: WORKSPACE_ID,
        environmentId: ENVIRONMENT_ID,
        name,
        slug: slugFor(name),
        type: String(body.type ?? "native_llm_agent"),
        role: (body.role as string | null) ?? null,
        instructions: (body.instructions as string | null) ?? null,
        llmConnectionId: (body.llmConnectionId as string | null) ?? null,
        modelName: (body.modelName as string | null) ?? null,
        temperature: (body.temperature as number | null) ?? null,
        maxTokens: (body.maxTokens as number | null) ?? null,
        maxIterations: (body.maxIterations as number | null) ?? null,
        memoryPolicy: (body.memoryPolicy as Record<string, unknown>) ?? {},
        retryPolicy: (body.retryPolicy as Record<string, unknown>) ?? {},
        timeoutPolicy: (body.timeoutPolicy as Record<string, unknown>) ?? {},
        approvalPolicy: (body.approvalPolicy as Record<string, unknown>) ?? {},
        allowedToolIds: Array.isArray(body.allowedToolIds) ? body.allowedToolIds : [],
        outputSchema: (body.outputSchema as Record<string, unknown>) ?? {},
        status: String(body.status ?? "active"),
        createdAt: now,
        updatedAt: now,
      };
    },
  ],
  /* A connection probe that says what it is. The real route opens a socket to
     the provider; a fixture cannot, and pretending otherwise would let a demo
     "verify" a credential that has never been dialled. So it reports success
     and names the reason in the same breath. */
  [
    "POST",
    "/api/connections/test-http-request",
    () => ({ status: null, latencyMs: 0, headers: {}, body: "", sizeBytes: 0, truncated: false,
      errorCode: "LIVE_API_REQUIRED", message: "Request sending requires a live API server. No request was sent in demo mode." }),
  ],
  [
    "POST",
    "/api/connections/test-unsaved",
    (_params, init) => {
      const body = (init.body ?? {}) as Record<string, unknown>;
      return {
        status: "connected",
        latencyMs: 128,
        errorCode: null,
        message: `Validated against fixtures — no ${String(body.provider ?? "provider")} socket was opened.`,
        testedAt: new Date().toISOString(),
        details: {},
      };
    },
  ],
  /* MCP discovery, as a fixture.
     The real route makes a JSON-RPC call to a customer's server and writes a
     `tools` row per remote tool. A mock can do neither, so it reports on the
     same fixture set the tool list serves — one source, so the count here and
     the rows on the Tools tab cannot disagree. */
  [
    "POST",
    "/api/connections/:id/mcp/discover",
    () => ({
      toolsFound: MCP_REMOTE_TOOLS.length,
      toolsWritten: MCP_REMOTE_TOOLS.length,
      toolsFlagged: MCP_REMOTE_TOOLS.filter((t) => t.description.includes("[removed]")).length,
      resourcesFound: 2,
      fetchedAt: new Date().toISOString(),
      stale: false,
      lastError: null,
      tools: MCP_REMOTE_TOOLS.map((t) => ({
        name: t.remote,
        description: t.description,
        descriptionWasAltered: t.description.includes("[removed]"),
      })),
    }),
  ],
  [
    "GET",
    "/api/connections/:id/mcp/tools",
    () => ({
      serverName: MCP_SERVER_NAME,
      manifest: {
        fetchedAt: MCP_DISCOVERED_AT,
        lastError: null,
        lastErrorAt: null,
        stale: false,
        toolCount: MCP_REMOTE_TOOLS.length,
        resourceCount: 2,
      },
      /* Withdrawn last, as the real query orders it — `ORDER BY
         possibly_withdrawn, name` puts what is live at the top and what is not
         where a person reads it after, rather than mixed through. */
      items: [...MCP_REMOTE_TOOLS]
        .sort((a, b) => Number(a.withdrawn ?? false) - Number(b.withdrawn ?? false))
        .map((t) => ({
          toolId: mcpToolId(t.remote),
          name: `mcp-${MCP_CONNECTION_ID.slice(0, 8)}.${t.remote}`,
          mcpToolName: t.remote,
          description: t.description,
          serverName: MCP_SERVER_NAME,
          lastSeenAt: t.withdrawn ? MCP_WITHDRAWN_SEEN_AT : MCP_DISCOVERED_AT,
          possiblyWithdrawn: t.withdrawn ?? false,
          grantedToAgentIds: t.grantedTo,
        })),
    }),
  ],

  /* Schema introspection, as a fixture.
     The real route opens a connection and reads `information_schema`. A mock
     cannot, so it serves a small, obviously-fake database rather than an empty
     one: an empty result is indistinguishable from a broken introspection, and
     the tool builder is unusable without tables to pick. The names say plainly
     that nothing was dialled. */
  [
    "POST",
    "/api/connections/:id/schema-preview",
    () => ({
      schemas: ["public", "billing"],
      provider: "postgresql",
      databaseName: "fixtures",
      fetchedAt: new Date().toISOString(),
      tables: [
        {
          schema: "public",
          table: "customers",
          tableType: "TABLE",
          rowCountEstimate: 12480,
          columns: [
            { name: "id", dataType: "uuid", nullable: false, isPrimaryKey: true, defaultValue: "gen_random_uuid()", maxLength: null },
            { name: "email", dataType: "text", nullable: false, isPrimaryKey: false, defaultValue: null, maxLength: null },
            { name: "full_name", dataType: "text", nullable: true, isPrimaryKey: false, defaultValue: null, maxLength: null },
            { name: "tier", dataType: "text", nullable: false, isPrimaryKey: false, defaultValue: "'free'", maxLength: 32 },
            { name: "created_at", dataType: "timestamptz", nullable: false, isPrimaryKey: false, defaultValue: "now()", maxLength: null },
          ],
        },
        {
          schema: "public",
          table: "subscriptions",
          tableType: "TABLE",
          rowCountEstimate: 9310,
          columns: [
            { name: "id", dataType: "uuid", nullable: false, isPrimaryKey: true, defaultValue: "gen_random_uuid()", maxLength: null },
            { name: "customer_id", dataType: "uuid", nullable: false, isPrimaryKey: false, defaultValue: null, maxLength: null },
            { name: "status", dataType: "text", nullable: false, isPrimaryKey: false, defaultValue: null, maxLength: 24 },
            { name: "renews_at", dataType: "timestamptz", nullable: true, isPrimaryKey: false, defaultValue: null, maxLength: null },
            { name: "amount_cents", dataType: "integer", nullable: false, isPrimaryKey: false, defaultValue: "0", maxLength: null },
          ],
        },
        {
          schema: "billing",
          table: "invoices",
          tableType: "TABLE",
          rowCountEstimate: 40218,
          columns: [
            { name: "id", dataType: "uuid", nullable: false, isPrimaryKey: true, defaultValue: "gen_random_uuid()", maxLength: null },
            { name: "customer_id", dataType: "uuid", nullable: false, isPrimaryKey: false, defaultValue: null, maxLength: null },
            { name: "total_cents", dataType: "integer", nullable: false, isPrimaryKey: false, defaultValue: "0", maxLength: null },
            { name: "paid", dataType: "boolean", nullable: false, isPrimaryKey: false, defaultValue: "false", maxLength: null },
            { name: "issued_on", dataType: "date", nullable: false, isPrimaryKey: false, defaultValue: null, maxLength: null },
          ],
        },
        /* Enough tables to cross `virtualiseAfter` in the picker. A real
           database has dozens; a four-table fixture never exercised the
           virtualised path, which is where the row-height bug bit hardest. */
        ...Array.from({ length: 48 }, (_, i) => ({
          schema: i % 3 === 0 ? "billing" : "public",
          table: `events_${String(i + 1).padStart(2, "0")}`,
          tableType: "TABLE" as const,
          rowCountEstimate: (i + 1) * 1013,
          columns: [
            { name: "id", dataType: "uuid", nullable: false, isPrimaryKey: true, defaultValue: "gen_random_uuid()", maxLength: null },
            { name: "occurred_at", dataType: "timestamptz", nullable: false, isPrimaryKey: false, defaultValue: "now()", maxLength: null },
            { name: "payload", dataType: "jsonb", nullable: true, isPrimaryKey: false, defaultValue: null, maxLength: null },
          ],
        })),
        {
          schema: "public",
          table: "active_customers",
          tableType: "VIEW",
          rowCountEstimate: null,
          columns: [
            { name: "id", dataType: "uuid", nullable: false, isPrimaryKey: false, defaultValue: null, maxLength: null },
            { name: "email", dataType: "text", nullable: false, isPrimaryKey: false, defaultValue: null, maxLength: null },
          ],
        },
      ],
    }),
  ],
  /* Triggering a run.
     The real route enqueues onto Redis and a worker executes the graph. A
     fixture cannot, so it mints a run id and says which mode it would have
     used — enough for the builder to navigate somewhere and for the failure
     paths to be exercised, without pretending a worker ran. */
  [
    "POST",
    "/api/workflows/:id/run",
    (params, init) => {
      const body = (init.body ?? {}) as Record<string, unknown>;
      const runId = uuidFrom(`run_${params.id}_${Date.now()}`);
      rememberTriggeredRun(runId, params.id);
      return { runId, status: "QUEUED", mode: String(body.mode ?? "simulation") };
    },
  ],
  [
    "POST",
    "/api/workflows/:id/runs/debug",
    (params) => {
      const runId = uuidFrom(`debugrun_${params.id}_${Date.now()}`);
      rememberTriggeredRun(runId, params.id);
      return { runId, status: "QUEUED", debugMode: true };
    },
  ],
  [
    "POST",
    "/api/tools/test-unsaved",
    () => ({
      valid: true,
      message: "Configuration validated against fixtures. No external action was executed.",
    }),
  ],
  [
    "POST",
    "/api/tools",
    (_params, init) => {
      const body = (init.body ?? {}) as Record<string, unknown>;
      const now = new Date().toISOString();
      const name = String(body.name ?? "Untitled tool");
      return {
        id: uuidFrom(`tool_created_${name}_${now}`),
        workspaceId: WORKSPACE_ID,
        environmentId: ENVIRONMENT_ID,
        name,
        slug: slugFor(name),
        type: String(body.type ?? "http"),
        description: (body.description as string | null) ?? null,
        connectionId: (body.connectionId as string | null) ?? null,
        inputSchema: (body.inputSchema as Record<string, unknown>) ?? {},
        outputSchema: (body.outputSchema as Record<string, unknown>) ?? {},
        config: (body.config as Record<string, unknown>) ?? {},
        riskLevel: String(body.riskLevel ?? "low"),
        requiresApproval: body.requiresApproval === true,
        timeoutMs: (body.timeoutMs as number | null) ?? null,
        retryPolicy: (body.retryPolicy as Record<string, unknown>) ?? {},
        idempotencyStrategy: (body.idempotencyStrategy as string | null) ?? null,
        status: String(body.status ?? "active"),
        createdAt: now,
        updatedAt: now,
      };
    },
  ],

  /* ── Architect ────────────────────────────────────────────────────────────
     The whole seven-stage pipeline, so the flow is walkable — and capturable —
     without a running Kotlin API or an LLM key. Responses are the API's shapes,
     adapted from the scripted fixture in `~/mocks/architect-api`. */
  [
    "GET",
    "/api/architect/usage",
    () => ({
      used: 0,
      limit: 1,
      remaining: 1,
      periodDays: 30,
      locked: false,
      lastBuildAt: null,
      resetAt: new Date(Date.now() + 26 * 86_400_000).toISOString(),
    }),
  ],
  [
    "POST",
    "/api/architect/sessions",
    (_params, init) => {
      const goal = String((init.body as { goal?: string } | undefined)?.goal ?? "");
      const id = uuidFrom(`architect_${goal.slice(0, 64)}`);
      const session = createMockSession(id, goal);
      return {
        id: session.id,
        status: session.status,
        currentStage: session.currentStage,
        userGoal: session.goal,
        // No clarification questions: the scripted prompt is specific enough to
        // design against, and inventing questions would make the fixture flow
        // depend on answers nobody can give meaningfully.
        clarificationQuestions: [],
        needsClarification: false,
        createdAt: session.createdAt,
      };
    },
  ],
  [
    "GET",
    "/api/architect/sessions/:id",
    (params) => {
      const session = getMockSession(params.id);
      if (!session) return notFound(`/api/architect/sessions/${params.id}`);
      return {
        id: session.id,
        status: session.status,
        currentStage: session.currentStage,
        userGoal: session.goal,
        plan: session.currentStage === "goal_capture" ? null : mockPlan(),
        connectionRequirements: session.requirements.map(requirementToApi),
        workflowId: session.workflowId,
        readinessStatus: session.workflowId ? "simulation_ready" : null,
        createdAt: session.createdAt,
      };
    },
  ],
  [
    "POST",
    "/api/architect/sessions/:id/generate-plan",
    (params) => {
      const session = getMockSession(params.id);
      if (session) session.currentStage = "plan_review";
      return {
        id: params.id,
        status: "plan_generated",
        currentStage: "plan_review",
        plan: mockPlan(),
        connectionRequirements: (session?.requirements ?? []).map(requirementToApi),
        generatedTools: [],
        generatedAgents: [],
        animationSteps: [],
      };
    },
  ],
  [
    "POST",
    "/api/architect/sessions/:id/revise-plan",
    (params) => ({
      id: params.id,
      status: "plan_generated",
      currentStage: "plan_review",
      // The fixture plan is scripted, so a revision returns it unchanged rather
      // than pretending to have applied an instruction it cannot interpret.
      plan: mockPlan(),
      connectionRequirements: (getMockSession(params.id)?.requirements ?? []).map(requirementToApi),
      animationSteps: [],
    }),
  ],
  [
    "POST",
    "/api/architect/sessions/:id/approve-plan",
    (params) => {
      const session = getMockSession(params.id);
      if (session) session.currentStage = "connection_setup";
      const requirements = (session?.requirements ?? []).map(requirementToApi);
      return {
        id: params.id,
        status: "plan_approved",
        currentStage: "connection_setup",
        connectionRequirements: requirements,
        needsConnections: requirements.length > 0,
      };
    },
  ],
  [
    "GET",
    "/api/architect/sessions/:id/connection-requirements",
    (params) => {
      const requirements = (getMockSession(params.id)?.requirements ?? []).map(requirementToApi);
      return {
        connectionRequirements: requirements,
        allReady: requirements.every(
          (r) => !r.requiredForSimulation
            || ["test_passed", "selected_existing", "created", "simulation_placeholder"].includes(r.status),
        ),
      };
    },
  ],
  [
    "POST",
    "/api/architect/sessions/:id/connection-requirements/:reqId/bind-existing",
    (params, init) => {
      const connectionId = String((init.body as { connectionId?: string } | undefined)?.connectionId ?? "");
      updateMockRequirement(params.id, params.reqId, {
        status: "selected_existing",
        boundConnectionId: connectionId,
        testStatus: null,
        testError: null,
      });
      return { id: params.reqId, status: "selected_existing" };
    },
  ],
  [
    "POST",
    "/api/architect/sessions/:id/connection-requirements/:reqId/use-simulation",
    (params) => {
      updateMockRequirement(params.id, params.reqId, { status: "simulation_placeholder" });
      return { id: params.reqId, status: "simulation_placeholder" };
    },
  ],
  [
    "POST",
    "/api/architect/sessions/:id/connection-requirements/:reqId/test",
    (params) => {
      updateMockRequirement(params.id, params.reqId, {
        status: "test_passed",
        testStatus: "passed",
        testError: null,
      });
      return {
        id: params.reqId,
        status: "test_passed",
        testStatus: "passed",
        ok: true,
        latencyMs: 42,
        message: "Connected.",
      };
    },
  ],
  [
    "POST",
    "/api/architect/sessions/:id/generate-tools",
    () => {
      const tools = mockPlan().tools.map((tool, index) => ({
        id: uuidFrom(`gt_${tool.tempToolId}`),
        tempToolId: tool.tempToolId,
        toolId: uuidFrom(`tool_real_${index}`),
        name: tool.name,
        type: tool.type,
        status: "created",
        riskLevel: tool.riskLevel,
        requiresApproval: tool.requiresApproval,
      }));
      return { tools, created: tools.length, blocked: 0 };
    },
  ],
  [
    "POST",
    "/api/architect/sessions/:id/generate-agents",
    () => {
      const agents = mockPlan().agents.map((agent, index) => ({
        id: uuidFrom(`ga_${agent.tempAgentId}`),
        tempAgentId: agent.tempAgentId,
        agentId: uuidFrom(`agent_real_${index}`),
        name: agent.name,
        type: agent.type,
        role: agent.role,
        status: "created",
        allowedTempToolIds: agent.allowedTempToolIds,
        boundToolIds: [],
      }));
      return { agents, created: agents.length };
    },
  ],
  [
    "POST",
    "/api/architect/sessions/:id/create-workflow",
    (params) => {
      const plan = mockPlan();
      const session = getMockSession(params.id);
      const workflowId = uuidFrom(`wf_architect_${params.id}`);
      if (session) {
        session.workflowId = workflowId;
        session.status = "workflow_created";
        session.currentStage = "complete";
      }
      const simulated = (session?.requirements ?? []).filter((r) => r.status === "simulation_placeholder");
      return {
        workflowId,
        workflowVersionId: uuidFrom(`wfv_architect_${params.id}`),
        workflowName: plan.workflowName,
        animationSteps: mockBuildSteps(),
        readinessStatus: simulated.length > 0 ? "simulation_ready" : "real_ready",
        readinessIssues: simulated.map((r) => ({
          severity: "info",
          code: "REAL_EXECUTION_LOCKED",
          message: `Real execution needs credentials for ${r.name}, which is currently simulated.`,
          targetType: "connection",
        })),
        toolsCreated: plan.tools.length,
        agentsCreated: plan.agents.length,
        status: "workflow_created",
      };
    },
  ],
  ["GET", "/api/architect/sessions/:id/build-steps", () => ({ buildSteps: mockBuildSteps() })],
  [
    "GET",
    "/api/architect/sessions/:id/readiness",
    (params) => {
      const session = getMockSession(params.id);
      return {
        readinessStatus: session?.workflowId ? "simulation_ready" : "needs_connections",
        readinessIssues: [],
        simulationReady: Boolean(session?.workflowId),
        realExecutionReady: false,
      };
    },
  ],
  [
    "GET",
    "/api/architect/connections",
    (_params, init) => {
      const preferred = String(init.query?.type ?? "").toLowerCase();
      return {
        connections: CONNECTIONS.map((connection) => ({
          id: uuidFrom(connection.id),
          name: connection.name,
          type: connection.provider,
          provider: connection.provider,
          status: connection.status,
          testStatus: connection.status,
          testedAt: connection.lastCheckedAt,
          typeMatches: preferred === "" || connection.provider.toLowerCase().includes(preferred)
            || preferred.includes(connection.provider.toLowerCase()),
        })),
        total: CONNECTIONS.length,
        preferredType: init.query?.type ? String(init.query.type) : undefined,
      };
    },
  ],
  [
    "GET",
    "/api/bootstrap",
    () => ({ workspaceId: WORKSPACE_ID, environmentId: ENVIRONMENT_ID }),
  ],

  /* The workspace-scoped environment list. Shaped exactly as `BootstrapRoutes`
     returns it, including `defaultEnvironmentId` — `useEnvironmentUuid` reads
     that field first, so a mock that omitted it would exercise a fallback the
     real transport never takes. */
  [
    "GET",
    "/api/environments",
    () => ({
      items: [{
        id: ENVIRONMENT_ID,
        workspaceId: WORKSPACE_ID,
        name: "Production",
        slug: "production",
        type: "production",
      }],
      total: 1,
      defaultEnvironmentId: ENVIRONMENT_ID,
    }),
  ],

  [
    "GET",
    "/api/approvals",
    (_params, init) => {
      const status = init.query?.status ? String(init.query.status).toUpperCase() : null;
      const items = liveApprovals().filter((a) => !status || a.status === status);
      return { items, total: items.length, page: 1, pageSize: items.length || 1 };
    },
  ],
  [
    "POST",
    "/api/approvals/:id/approve",
    (params) => {
      APPROVAL_DECISIONS.set(params.id, { status: "APPROVED", reason: null });
      return { decided: true };
    },
  ],
  [
    "POST",
    "/api/approvals/:id/reject",
    (params, init) => {
      const reason = (init.body as { reason?: string } | undefined)?.reason ?? null;
      APPROVAL_DECISIONS.set(params.id, { status: "REJECTED", reason });
      return { decided: true };
    },
  ],

  [
    "GET",
    "/api/failure-incidents",
    (_params, init) => {
      const status = init.query?.status ? String(init.query.status) : null;
      const limit = Number(init.query?.limit ?? 50);
      return liveIncidents()
        .filter((incident) => !status || incident.resolutionStatus === status)
        .slice(0, limit);
    },
  ],
  [
    "POST",
    "/api/failure-incidents/mark-all-resolved",
    () => {
      const open = liveIncidents().filter((i) => i.resolutionStatus !== "resolved");
      for (const incident of open) RESOLVED_INCIDENT_IDS.add(incident.id);
      return { resolved: open.length };
    },
  ],
  [
    "POST",
    "/api/failure-incidents/delete-resolved",
    () => {
      const resolved = liveIncidents().filter((i) => i.resolutionStatus === "resolved");
      for (const incident of resolved) DELETED_INCIDENT_IDS.add(incident.id);
      return { deleted: resolved.length };
    },
  ],
  [
    "GET",
    "/api/failure-incidents/:id",
    (params) => {
      const found = liveIncidents().find((incident) => incident.id === params.id);
      if (!found) return notFound(`/api/failure-incidents/${params.id}`);
      return found;
    },
  ],
  [
    "POST",
    "/api/failure-incidents/:id/mark-resolved",
    (params) => {
      RESOLVED_INCIDENT_IDS.add(params.id);
      return { resolved: true };
    },
  ],
  [
    "DELETE",
    "/api/failure-incidents/:id",
    (params) => {
      if (!liveIncidents().some((incident) => incident.id === params.id)) {
        return notFound(`/api/failure-incidents/${params.id}`);
      }
      DELETED_INCIDENT_IDS.add(params.id);
      return { deleted: true };
    },
  ],

  [
    "GET",
    "/api/control/metrics",
    () => ({
      workspace: {
        queued: RUNS.filter((r) => r.status === "queued").length,
        queueByPriority: [{ priority: "normal", depth: 3 }],
        inFlight: RUNS.filter((r) => r.status === "running").length,
        inFlightByClass: { short: 2, long: 1 },
        maxConcurrentRuns: 8,
        utilisation: 0.375,
      },
      fleet: { workersAlive: 4, slotsTotal: 32, slotsAvailable: 29 },
      waitReason: null,
      freshness: { workspace: "live", fleet: "up to 15s (worker heartbeat interval)" },
    }),
  ],
  [
    "GET",
    "/api/control/activity",
    (_params, init) => RUNS.slice(0, Number(init.query?.limit ?? 20)).map((run, index) => ({
      id: uuidFrom(`activity:${run.id}:${index}`),
      runId: uuidFrom(run.id),
      type: run.status === "failed" ? "RUN_FAILED" : run.status === "succeeded" ? "RUN_SUCCEEDED" : "RUN_STARTED",
      status: toApiStatus(run.status),
      source: run.trigger,
      timestamp: run.finishedAt ?? run.startedAt,
      durationMs: run.durationMs,
      stepId: null,
      title: null,
      summary: null,
      workflowName: run.workflowName,
    })),
  ],
];

export function createMockTransport(): Transport {
  return {
    async request<T>(path: string, init: RequestOptions = {}): Promise<T> {
      await delay();

      if (init.signal?.aborted) throw VectorbeaApiError.aborted("mock");

      const method = init.method ?? "GET";
      const cleanPath = path.split("?")[0];

      for (const [routeMethod, pattern, handler] of ROUTES) {
        if (routeMethod !== method) continue;
        const params = match(pattern, cleanPath);
        if (!params) continue;

        const body = handler(params, init);

        // Validate the MOCK against the same contract as the live response.
        // Without this the fixtures drift from the schema and mock mode goes
        // back to being a parallel reality that proves nothing.
        if (init.schema) {
          const result = init.schema.safeParse(body);
          if (!result.success) {
            throw VectorbeaApiError.contractMismatch({
              path: `${method} ${cleanPath} (mock)`,
              issues: result.error.issues,
              requestId: "mock",
              received: body,
            });
          }
          return result.data as T;
        }

        return body as T;
      }

      // Mutations without a fixture echo back rather than 404, so builder and
      // form flows are clickable in mock mode without every endpoint stubbed.
      if (method !== "GET") return { ok: true, echoed: init.body ?? null } as T;

      return notFound(cleanPath);
    },
  };
}
