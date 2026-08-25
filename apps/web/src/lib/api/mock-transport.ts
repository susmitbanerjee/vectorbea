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
  // Everything else in the fixture set — Stripe, Slack, Gmail, HubSpot, GitHub
  // — is reached over HTTP, which is what the API would store for them.
  return "http";
}

/** `AUTH_TYPES` uses snake_case. The connectivity fixtures use a display form. */
function authTypeFor(provider: string): string {
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

const ROUTES: [method: string, pattern: string, handler: Handler][] = [
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
        TOOLS.map((tool) => ({
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
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        })),
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
