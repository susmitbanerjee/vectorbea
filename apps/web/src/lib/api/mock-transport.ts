import { AGENTS, CONNECTIONS, RUNS, TOOLS, WORKFLOWS } from "~/mocks/fixtures";
import { WORKSPACES } from "~/mocks/shell";
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

const WORKSPACE_ID = uuidFrom("ws_acme");
const ENVIRONMENT_ID = uuidFrom("env_production");

/** Map the UI's run vocabulary back to the API's. */
function toApiStatus(status: UiRun["status"]): string {
  if (status === "succeeded") return "completed";
  if (status === "awaiting-approval") return "awaiting_approval";
  return status;
}

/** A fixture run, adapted to `contracts.runSummary`. */
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
  ["GET", "/api/workspaces", () => ({ workspaces: WORKSPACES })],

  [
    "GET",
    "/api/me",
    () => ({
      id: uuidFrom("usr_mock"),
      email: "operator@vectorbea.dev",
      fullName: "Mock Operator",
      betaStatus: "approved",
      isPlatformAdmin: false,
      workspaces: WORKSPACES.map((w) => w.id),
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
      const run = RUNS.find((r) => uuidFrom(r.id) === params.id || r.id === params.id);
      if (!run) return notFound(`/api/runs/${params.id}`);
      return { ...toApiRun(run), outputJson: null, errorJson: null };
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
          type: connection.provider,
          provider: connection.provider,
          status: connection.status,
          networkStatus: connection.status === "healthy" ? "reachable" : "degraded",
          authType: "api-key",
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
