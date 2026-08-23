import { contracts } from "@vectorbea/shared";
import type { Workspace } from "~/mocks/shell";
import type {
  AnimationStep, ArchitectPlan, ArchitectSession, ArchitectUsage,
  ConnectionRequirement, CreatedWorkflowResult, GeneratedAgent, GeneratedTool,
  ReadinessIssue, WorkspaceConnectionOption,
} from "~/lib/architect/types";

import { isMockMode } from "./config";
import { createMockTransport } from "./mock-transport";
import type { RequestOptions, SessionExpiredHandler, TokenSource, Transport } from "./transport";
import { createFetchTransport } from "./transport";

/**
 * The typed API client.
 *
 * Types come from the CONTRACTS in `@vectorbea/shared`, not from the UI
 * fixtures. They used to come from `~/mocks/domain`, which was wrong in a way
 * that hid itself: the fixtures describe what the screens want, the contracts
 * describe what the API sends, and those are not the same shape. Typing the
 * client from the fixtures meant mock mode never exercised the real contract —
 * a screen could pass in mock and break the moment it hit a live endpoint.
 *
 * The deltas between the two are the shape gaps in docs/integration/API-GAPS.md.
 *
 * Resource methods are thin: they name a path, a shape, and a schema. Everything
 * hard — auth, retries, timeouts, validation, the error taxonomy — lives in the
 * transport.
 */

type Run = contracts.RunSummary;
type RunDetail = contracts.RunDetail;
type Workflow = contracts.Workflow;
type WorkflowVersion = contracts.WorkflowVersion;
type Agent = contracts.Agent;
type Tool = contracts.Tool;
type Connection = contracts.Connection;
export interface ConnectionTestResult {
  status: "connected" | "failed" | "private_runner_required" | "whitelist_required";
  latencyMs: number;
  errorCode: string | null;
  message: string;
  testedAt: string;
  details: Record<string, unknown>;
}
export interface RegistryTestResult { valid: boolean; message: string; details?: Record<string, unknown> }

/**
 * `POST /api/connections/test-unsaved` body, as `ConnectionTestRoutes.UnsavedTestBody`
 * declares it.
 *
 * The point of this endpoint is that it runs BEFORE anything is written: the
 * plaintext credential is posted over TLS, used for one probe, and never stored
 * or logged. Testing after saving would leave a broken connection in the
 * registry every time somebody fat-fingers a password.
 */
export interface TestConnectionDraftBody {
  type: string;
  provider: string;
  authType?: string;
  plaintextSecret?: string | null;
  config?: Record<string, unknown>;
}

/** `POST /api/tools/test-unsaved` body, as `ToolRoutes.TestToolBody` declares it. */
export interface TestToolDraftBody {
  type: string;
  connectionId?: string | null;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  config?: Record<string, unknown>;
}
type Approval = contracts.Approval;
type FailureIncident = contracts.FailureIncident;
type Schedule = contracts.Schedule;
type Worker = contracts.Worker;
type ControlMetrics = contracts.ControlMetrics;
type ControlActivityEvent = contracts.ControlActivityEvent;
type QueuePosition = contracts.QueuePosition;
type NodeDebugSummary = contracts.NodeDebugSummary;
type NodeDebugDetail = contracts.NodeDebugDetail;

/**
 * The paginated envelope, as `repository/Page.kt` actually returns it.
 *
 * Note `page`/`pageSize`, NOT `limit`/`cursor` — and note that the items live
 * under `items`, not under an entity-named key. An earlier version of this file
 * looked for `payload.runs`, which silently produced an empty list for every
 * endpoint. That is the class of bug the contracts exist to make impossible.
 */
export type Paged<T> = contracts.Page<T>;

/** Scope headers every product endpoint carries. */
export interface Scope {
  workspaceId?: string | null;
  environmentId?: string | null;
}

/**
 * `GET /api/me`. The single source of truth for identity AND role.
 *
 * Typed from the contract rather than hand-written: the previous hand-written
 * shape claimed `workspaces: string[]`, when the endpoint actually returns
 * `{ id, name, slug, role }` per membership. Losing `role` on the way in is how
 * a screen ends up deriving it from somewhere else.
 */
export type CurrentUser = contracts.Me;

/** Pagination as the API defines it. 1-based; `pageSize` is capped at 100. */
export interface PageParams {
  page?: number;
  pageSize?: number;
}

export interface RunListFilters extends Scope, PageParams {
  status?: string;
  workflowId?: string;
}

/**
 * `POST /api/workflows` body, as `WorkflowRoutes.CreateWorkflowBody` declares it.
 *
 * There is no trigger field, and that absence is the API's shape rather than an
 * omission here: a workflow row carries name, slug, description and status only.
 * The trigger lives on a VERSION, which is why creating a scheduled workflow is
 * two calls rather than one.
 */
export interface CreateWorkflowBody {
  name: string;
  slug?: string;
  description?: string | null;
  /**
   * One of `native`, `imported`, `instrumented`, `endpoint_only`.
   *
   * Defaults to `native` server-side, and `WorkflowRoutes.create` validates it
   * against that set — sending anything else is a 400, and sending nothing is
   * how a workflow that was meant to wrap existing code ends up claiming full
   * replay it cannot deliver.
   */
  creationMode?: string;
  /** One of `WORKFLOW_STATUSES`. Defaults to `draft` server-side. */
  status?: string;
}

/** `POST /api/workflows/:id/versions` body. `graph` is the only required field. */
export interface CreateWorkflowVersionBody {
  graph: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  triggerConfig?: Record<string, unknown>;
  retryPolicy?: Record<string, unknown>;
  timeoutPolicy?: Record<string, unknown>;
  budgetPolicy?: Record<string, unknown>;
  replaySupport?: string;
}

/**
 * How long an LLM-backed architect call is given before the transport aborts it.
 *
 * Plan generation calls a frontier model with a long prompt; 15 seconds is not
 * enough and the abort is not free — `createWorkflow` holds a per-workspace
 * advisory lock, so a client that walks away mid-build leaves the next attempt
 * to 409 until the server finishes.
 */
const ARCHITECT_TIMEOUT_MS = 120_000;

/**
 * `GET /api/bootstrap`. Workspace and environment UUIDs, no auth required.
 *
 * This is the only endpoint that hands back an ENVIRONMENT id, which is why it
 * is on the client at all: the workspace provider carries the environment as a
 * display slug, and every write endpoint wants the UUID.
 */
export interface BootstrapIds {
  workspaceId?: string;
  environmentId?: string;
}

export interface VectorbeaClient {
  readonly transport: Transport;

  me(options?: RequestOptions): Promise<CurrentUser>;
  bootstrap(options?: RequestOptions): Promise<BootstrapIds>;
  workspaces(options?: RequestOptions): Promise<Workspace[]>;
  controlMetrics(scope?: Scope, options?: RequestOptions): Promise<ControlMetrics>;
  controlActivity(
    params?: Scope & { limit?: number },
    options?: RequestOptions,
  ): Promise<ControlActivityEvent[]>;
  workers(scope?: Scope, options?: RequestOptions): Promise<Worker[]>;

  runs: {
    list(filters?: RunListFilters, options?: RequestOptions): Promise<Paged<Run>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<RunDetail>;
    queuePosition(id: string, scope?: Scope, options?: RequestOptions): Promise<QueuePosition>;
    purgeQueued(scope?: Scope, options?: RequestOptions): Promise<{ purged: number; status: string }>;
    cancel(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
    retry(id: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
    retryNode(id: string, nodeId: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
  };

  workflows: {
    list(params?: Scope & PageParams, options?: RequestOptions): Promise<Paged<Workflow>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<Workflow>;
    /**
     * `GET /api/workflows/:id/versions` — a PAGE, not a bare array.
     *
     * It was typed `WorkflowVersion[]` and returns `Page<WorkflowVersion>`, so
     * every caller that mapped over the result was mapping over an object. The
     * route is `Response.ok(page.mapItems { … })`; the envelope is not optional.
     */
    versions(
      id: string,
      params?: Scope & PageParams,
      options?: RequestOptions,
    ): Promise<Paged<WorkflowVersion>>;
    /**
     * `POST /api/workflows`. The environment is NOT optional here the way it is
     * on a read: `WorkflowRoutes.create` calls `requireEnvironmentId()`, so a
     * scope carrying the display slug instead of a UUID fails with a 400 rather
     * than degrading to workspace scope. Callers resolve the real id through
     * `useEnvironmentUuid()`.
     */
    create(body: CreateWorkflowBody, scope?: Scope, options?: RequestOptions): Promise<Workflow>;
    /**
     * `POST /api/workflows/:id/versions`.
     *
     * Also what materialises a cron schedule: `WorkflowRoutes.syncSchedule`
     * reads `triggerConfig` off this body, so a workflow created without a
     * version has no schedule row no matter which trigger the form selected.
     */
    createVersion(
      id: string,
      body: CreateWorkflowVersionBody,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<WorkflowVersion>;
    run(id: string, input?: unknown, scope?: Scope, options?: RequestOptions): Promise<unknown>;
    update(id: string, patch: Record<string, unknown>, scope?: Scope, options?: RequestOptions): Promise<Workflow>;
    delete(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
  };

  /**
   * AI Workflow Architect.
   *
   * Every call is workspace-scoped and most are LLM-backed, so they carry a far
   * longer timeout than the 15s default — plan generation against a real model
   * routinely takes 30–60 seconds, and timing one out mid-flight spends a
   * workspace's rationed build for nothing.
   */
  architect: {
    usage(scope?: Scope, options?: RequestOptions): Promise<ArchitectUsage>;
    createSession(goal: string, scope?: Scope, options?: RequestOptions): Promise<ArchitectSession>;
    session(id: string, scope?: Scope, options?: RequestOptions): Promise<ArchitectSession>;
    generatePlan(
      id: string,
      answers?: Record<string, string>,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<ArchitectSession & { plan: ArchitectPlan }>;
    revisePlan(
      id: string,
      instruction: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<ArchitectSession & { plan: ArchitectPlan }>;
    approvePlan(
      id: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{ connectionRequirements: ConnectionRequirement[]; needsConnections: boolean }>;
    connectionRequirements(
      id: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{ connectionRequirements: ConnectionRequirement[]; allReady: boolean }>;
    bindConnection(
      id: string,
      requirementId: string,
      connectionId: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{ id: string; status: string }>;
    useSimulation(
      id: string,
      requirementId: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{ id: string; status: string }>;
    testConnection(
      id: string,
      requirementId: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{
      id: string; status: string; testStatus: string;
      ok: boolean; latencyMs: number; message: string;
    }>;
    generateTools(
      id: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{ tools: GeneratedTool[]; created: number; blocked: number }>;
    generateAgents(
      id: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{ agents: GeneratedAgent[]; created: number }>;
    createWorkflow(
      id: string,
      connectionBindings?: Record<string, string>,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<CreatedWorkflowResult>;
    buildSteps(
      id: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{ buildSteps: AnimationStep[] }>;
    readiness(
      id: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{
      readinessStatus: string;
      readinessIssues: ReadinessIssue[];
      simulationReady: boolean;
      realExecutionReady: boolean;
    }>;
    connections(
      preferredType?: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{ connections: WorkspaceConnectionOption[]; total: number; preferredType?: string }>;
  };

  agents: {
    list(params?: Scope & PageParams, options?: RequestOptions): Promise<Paged<Agent>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<Agent>;
    create(body: Record<string, unknown>, scope?: Scope, options?: RequestOptions): Promise<Agent>;
    test(id: string, scope?: Scope, options?: RequestOptions): Promise<RegistryTestResult>;
    update(id: string, patch: Record<string, unknown>, scope?: Scope, options?: RequestOptions): Promise<Agent>;
    delete(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
  };

  tools: {
    list(params?: Scope & PageParams, options?: RequestOptions): Promise<Paged<Tool>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<Tool>;
    create(body: Record<string, unknown>, scope?: Scope, options?: RequestOptions): Promise<Tool>;
    test(id: string, scope?: Scope, options?: RequestOptions): Promise<RegistryTestResult>;
    /**
     * `POST /api/tools/test-unsaved` — validate a configuration that has not
     * been persisted, so the registry form can check its work BEFORE it writes
     * a row.
     *
     * Side-effect free by contract: the route validates the adapter, the
     * connection compatibility and the config shape, and never executes the
     * tool. That is the whole point — a DELETE endpoint or a database write
     * must be checkable without being fired.
     */
    testDraft(body: TestToolDraftBody, scope?: Scope, options?: RequestOptions): Promise<RegistryTestResult>;
    update(id: string, patch: Record<string, unknown>, scope?: Scope, options?: RequestOptions): Promise<Tool>;
    delete(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
  };

  connections: {
    list(params?: Scope & PageParams, options?: RequestOptions): Promise<Paged<Connection>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<Connection>;
    create(body: Record<string, unknown>, scope?: Scope, options?: RequestOptions): Promise<Connection>;
    update(id: string, patch: Record<string, unknown>, scope?: Scope, options?: RequestOptions): Promise<Connection>;
    delete(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
    test(id: string, scope?: Scope, options?: RequestOptions): Promise<ConnectionTestResult>;
    /** Probe a credential that has not been saved. Side-effect free. */
    testDraft(
      body: TestConnectionDraftBody,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<ConnectionTestResult>;
  };
  schedules: {
    list(scope?: Scope, options?: RequestOptions): Promise<Schedule[]>;
    setEnabled(id: string, enabled: boolean, scope?: Scope, options?: RequestOptions): Promise<unknown>;
  };

  approvals: {
    list(params?: Scope & PageParams & { status?: string }, options?: RequestOptions): Promise<Paged<Approval>>;
    approve(id: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
    reject(id: string, reason: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
  };

  /**
   * Failure incidents.
   *
   * `list` returns a FLAT array, not a page — the endpoint predates the Page
   * envelope. Kept honest here rather than wrapped to look paginated, because a
   * caller that thinks it can page through these will silently see only the
   * first `limit` rows.
   */
  incidents: {
    list(
      params?: Scope & { status?: string; category?: string; limit?: number },
      options?: RequestOptions,
    ): Promise<FailureIncident[]>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<FailureIncident>;
    resolve(id: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
    resolveAll(scope?: Scope, options?: RequestOptions): Promise<{ resolved: number }>;
  };

  debug: {
    nodes(runId: string, scope?: Scope, options?: RequestOptions): Promise<NodeDebugSummary[]>;
    node(
      runId: string,
      nodeId: string,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<NodeDebugDetail>;
  };
}

export interface CreateClientOptions {
  getToken: TokenSource;
  onSessionExpired?: SessionExpiredHandler;
  /** Force a transport, bypassing NEXT_PUBLIC_DATA_MODE. Used by tests. */
  transport?: Transport;
  baseUrl?: string;
}

export function createVectorbeaClient(options: CreateClientOptions): VectorbeaClient {
  const transport =
    options.transport ??
    (isMockMode()
      ? createMockTransport()
      : createFetchTransport({
          getToken: options.getToken,
          onSessionExpired: options.onSessionExpired,
          baseUrl: options.baseUrl,
        }));

  /** Merges scope and pagination into request options. */
  const req = (
    scope: Scope | undefined,
    schema: RequestOptions["schema"],
    options?: RequestOptions,
    query?: RequestOptions["query"],
  ): RequestOptions => ({
    workspaceId: scope?.workspaceId ?? null,
    environmentId: scope?.environmentId ?? null,
    schema,
    ...options,
    query: { ...query, ...options?.query },
  });

  const call = <T,>(path: string, requestOptions: RequestOptions): Promise<T> =>
    transport.request<T>(path, requestOptions);

  return {
    transport,

    me: (options) => call<CurrentUser>("/api/me", { schema: contracts.me, ...options }),

    bootstrap: (options) => call<BootstrapIds>("/api/bootstrap", { ...options }),

    workspaces: async (options) => {
      const payload = await call<{ workspaces?: Workspace[] }>("/api/workspaces", {
        ...options,
      });
      return payload?.workspaces ?? [];
    },

    controlMetrics: (scope, options) =>
      call<ControlMetrics>("/api/control/metrics", req(scope, contracts.controlMetrics, options)),

    controlActivity: ({ workspaceId, environmentId, limit } = {}, options) =>
      call<ControlActivityEvent[]>(
        "/api/control/activity",
        req({ workspaceId, environmentId }, contracts.controlActivityList, options, { limit }),
      ),

    workers: (scope, options) =>
      call<Worker[]>("/api/workers", req(scope, contracts.workerList, options)),

    runs: {
      list: ({ workspaceId, environmentId, page, pageSize, ...filters } = {}, options) =>
        call<Paged<Run>>(
          "/api/runs",
          req({ workspaceId, environmentId }, contracts.runPage, options, {
            page,
            pageSize,
            ...filters,
          }),
        ),
      get: (id, scope, options) =>
        call<RunDetail>(`/api/runs/${id}`, req(scope, contracts.runDetail, options)),
      queuePosition: (id, scope, options) =>
        call<QueuePosition>(
          `/api/runs/${id}/queue-position`,
          req(scope, contracts.queuePosition, options),
        ),
      purgeQueued: (scope, options) =>
        call<{ purged: number; status: string }>("/api/runs/purge-queued", {
          method: "POST",
          ...req(scope, undefined, options),
        }),
      cancel: (id, scope, options) =>
        call<void>(`/api/runs/${id}/cancel`, {
          method: "POST",
          ...req(scope, undefined, options),
        }),
      retry: (id, scope, options) =>
        call<unknown>(`/api/runs/${id}/retry`, {
          method: "POST",
          ...req(scope, undefined, options),
        }),
      retryNode: (id, nodeId, scope, options) =>
        call<unknown>(`/api/runs/${id}/retry-node`, {
          method: "POST",
          body: { nodeId },
          ...req(scope, undefined, options),
        }),
    },

    workflows: {
      list: ({ workspaceId, environmentId, page, pageSize } = {}, options) =>
        call<Paged<Workflow>>(
          "/api/workflows",
          req({ workspaceId, environmentId }, contracts.workflowPage, options, { page, pageSize }),
        ),
      get: (id, scope, options) =>
        call<Workflow>(`/api/workflows/${id}`, req(scope, contracts.workflow, options)),
      versions: (id, { workspaceId, environmentId, page, pageSize } = {}, options) =>
        call<Paged<WorkflowVersion>>(
          `/api/workflows/${id}/versions`,
          req({ workspaceId, environmentId }, contracts.workflowVersionPage, options, { page, pageSize }),
        ),
      run: (id, input, scope, options) =>
        call<unknown>(`/api/workflows/${id}/run`, {
          method: "POST",
          body: input ?? {},
          ...req(scope, undefined, options),
        }),
      create: (body, scope, options) =>
        call<Workflow>("/api/workflows", {
          method: "POST",
          body,
          ...req(scope, contracts.workflow, options),
        }),
      createVersion: (id, body, scope, options) =>
        call<WorkflowVersion>(`/api/workflows/${id}/versions`, {
          method: "POST",
          body,
          ...req(scope, contracts.workflowVersion, options),
        }),
      update: (id, patch, scope, options) =>
        call<Workflow>(`/api/workflows/${id}`, {
          method: "PATCH",
          body: patch,
          ...req(scope, contracts.workflow, options),
        }),
      delete: (id, scope, options) =>
        call<void>(`/api/workflows/${id}`, { method: "DELETE", ...req(scope, undefined, options) }),
    },

    /**
     * Architect calls are deliberately UNVALIDATED — no `schema` argument.
     *
     * The plan body is model-authored and its optional fields come and go with
     * the prompt version. A Zod contract over it would convert "the model left
     * out safetyNotes" into a hard client error on a response that is otherwise
     * perfectly usable, and it would do so after the workspace had already
     * spent one of its rationed builds. The types in `~/lib/architect/types`
     * describe the shape; the view treats every optional field as optional.
     */
    architect: {
      usage: (scope, options) =>
        call<ArchitectUsage>("/api/architect/usage", req(scope, undefined, options)),

      createSession: (goal, scope, options) =>
        call<ArchitectSession>("/api/architect/sessions", {
          method: "POST",
          body: { goal },
          timeoutMs: ARCHITECT_TIMEOUT_MS,
          ...req(scope, undefined, options),
        }),

      session: (id, scope, options) =>
        call<ArchitectSession>(`/api/architect/sessions/${id}`, req(scope, undefined, options)),

      generatePlan: (id, answers, scope, options) =>
        call<ArchitectSession & { plan: ArchitectPlan }>(
          `/api/architect/sessions/${id}/generate-plan`,
          {
            method: "POST",
            body: { answers: answers ?? {} },
            timeoutMs: ARCHITECT_TIMEOUT_MS,
            ...req(scope, undefined, options),
          },
        ),

      revisePlan: (id, instruction, scope, options) =>
        call<ArchitectSession & { plan: ArchitectPlan }>(
          `/api/architect/sessions/${id}/revise-plan`,
          {
            method: "POST",
            body: { instruction },
            timeoutMs: ARCHITECT_TIMEOUT_MS,
            ...req(scope, undefined, options),
          },
        ),

      approvePlan: (id, scope, options) =>
        call<{ connectionRequirements: ConnectionRequirement[]; needsConnections: boolean }>(
          `/api/architect/sessions/${id}/approve-plan`,
          { method: "POST", ...req(scope, undefined, options) },
        ),

      connectionRequirements: (id, scope, options) =>
        call<{ connectionRequirements: ConnectionRequirement[]; allReady: boolean }>(
          `/api/architect/sessions/${id}/connection-requirements`,
          req(scope, undefined, options),
        ),

      bindConnection: (id, requirementId, connectionId, scope, options) =>
        call<{ id: string; status: string }>(
          `/api/architect/sessions/${id}/connection-requirements/${requirementId}/bind-existing`,
          { method: "POST", body: { connectionId }, ...req(scope, undefined, options) },
        ),

      useSimulation: (id, requirementId, scope, options) =>
        call<{ id: string; status: string }>(
          `/api/architect/sessions/${id}/connection-requirements/${requirementId}/use-simulation`,
          { method: "POST", ...req(scope, undefined, options) },
        ),

      testConnection: (id, requirementId, scope, options) =>
        call<{
          id: string; status: string; testStatus: string;
          ok: boolean; latencyMs: number; message: string;
        }>(
          `/api/architect/sessions/${id}/connection-requirements/${requirementId}/test`,
          { method: "POST", timeoutMs: 45_000, ...req(scope, undefined, options) },
        ),

      generateTools: (id, scope, options) =>
        call<{ tools: GeneratedTool[]; created: number; blocked: number }>(
          `/api/architect/sessions/${id}/generate-tools`,
          { method: "POST", timeoutMs: ARCHITECT_TIMEOUT_MS, ...req(scope, undefined, options) },
        ),

      generateAgents: (id, scope, options) =>
        call<{ agents: GeneratedAgent[]; created: number }>(
          `/api/architect/sessions/${id}/generate-agents`,
          { method: "POST", timeoutMs: ARCHITECT_TIMEOUT_MS, ...req(scope, undefined, options) },
        ),

      createWorkflow: (id, connectionBindings, scope, options) =>
        call<CreatedWorkflowResult>(
          `/api/architect/sessions/${id}/create-workflow`,
          {
            method: "POST",
            body: { connectionBindings: connectionBindings ?? {} },
            timeoutMs: ARCHITECT_TIMEOUT_MS,
            ...req(scope, undefined, options),
          },
        ),

      buildSteps: (id, scope, options) =>
        call<{ buildSteps: AnimationStep[] }>(
          `/api/architect/sessions/${id}/build-steps`,
          req(scope, undefined, options),
        ),

      readiness: (id, scope, options) =>
        call<{
          readinessStatus: string;
          readinessIssues: ReadinessIssue[];
          simulationReady: boolean;
          realExecutionReady: boolean;
        }>(`/api/architect/sessions/${id}/readiness`, req(scope, undefined, options)),

      connections: (preferredType, scope, options) =>
        call<{ connections: WorkspaceConnectionOption[]; total: number; preferredType?: string }>(
          "/api/architect/connections",
          req(scope, undefined, options, { type: preferredType }),
        ),
    },

    agents: {
      list: ({ workspaceId, environmentId, page, pageSize } = {}, options) =>
        call<Paged<Agent>>(
          "/api/agents",
          req({ workspaceId, environmentId }, contracts.agentPage, options, { page, pageSize }),
        ),
      get: (id, scope, options) =>
        call<Agent>(`/api/agents/${id}`, req(scope, contracts.agent, options)),
      create: (body, scope, options) =>
        call<Agent>("/api/agents", { method: "POST", body, ...req(scope, contracts.agent, options) }),
      test: async (id, scope, options) => {
        const agent = await call<Agent>(`/api/agents/${id}`, req(scope, contracts.agent, options));
        if (!agent.instructions?.trim()) return { valid: false, message: "Agent has no system instructions." };
        if (!agent.llmConnectionId) return { valid: true, message: "Agent configuration is valid and uses the workspace model connection." };
        const result = await call<ConnectionTestResult>(`/api/connections/${agent.llmConnectionId}/test`, { method: "POST", ...req(scope, undefined, options) });
        return { valid: result.status === "connected", message: result.message, details: { connectionStatus: result.status, latencyMs: result.latencyMs } };
      },
      update: (id, patch, scope, options) =>
        call<Agent>(`/api/agents/${id}`, { method: "PATCH", body: patch, ...req(scope, contracts.agent, options) }),
      delete: (id, scope, options) =>
        call<void>(`/api/agents/${id}`, { method: "DELETE", ...req(scope, undefined, options) }),
    },

    tools: {
      list: ({ workspaceId, environmentId, page, pageSize } = {}, options) =>
        call<Paged<Tool>>(
          "/api/tools",
          req({ workspaceId, environmentId }, contracts.toolPage, options, { page, pageSize }),
        ),
      get: (id, scope, options) =>
        call<Tool>(`/api/tools/${id}`, req(scope, contracts.tool, options)),
      create: (body, scope, options) =>
        call<Tool>("/api/tools", { method: "POST", body, ...req(scope, contracts.tool, options) }),
      test: async (id, scope, options) => {
        const tool = await call<Tool>(`/api/tools/${id}`, req(scope, contracts.tool, options));
        return call<RegistryTestResult>("/api/tools/test-unsaved", {
          method: "POST",
          body: { type: tool.type, connectionId: tool.connectionId, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, config: tool.config },
          ...req(scope, undefined, options),
        });
      },
      testDraft: (body, scope, options) =>
        call<RegistryTestResult>("/api/tools/test-unsaved", {
          method: "POST",
          body: { ...body, connectionId: body.connectionId ?? null },
          ...req(scope, undefined, options),
        }),
      update: (id, patch, scope, options) =>
        call<Tool>(`/api/tools/${id}`, { method: "PATCH", body: patch, ...req(scope, contracts.tool, options) }),
      delete: (id, scope, options) =>
        call<void>(`/api/tools/${id}`, { method: "DELETE", ...req(scope, undefined, options) }),
    },

    connections: {
      list: ({ workspaceId, environmentId, page, pageSize } = {}, options) =>
        call<Paged<Connection>>(
          "/api/connections",
          req({ workspaceId, environmentId }, contracts.connectionPage, options, {
            page,
            pageSize,
          }),
        ),
      get: (id, scope, options) =>
        call<Connection>(`/api/connections/${id}`, req(scope, contracts.connection, options)),
      create: (body, scope, options) =>
        call<Connection>("/api/connections", { method: "POST", body, ...req(scope, contracts.connection, options) }),
      update: (id, patch, scope, options) =>
        call<Connection>(`/api/connections/${id}`, {
          method: "PATCH",
          body: patch,
          ...req(scope, contracts.connection, options),
        }),
      delete: (id, scope, options) =>
        call<void>(`/api/connections/${id}`, { method: "DELETE", ...req(scope, undefined, options) }),
      testDraft: (body, scope, options) =>
        call<ConnectionTestResult>("/api/connections/test-unsaved", {
          method: "POST",
          body: {
            ...body,
            authType: body.authType ?? "api_key",
            plaintextSecret: body.plaintextSecret ?? null,
            config: body.config ?? {},
          },
          // A real provider round trip. The 15s default abandons a cold
          // database or a slow SaaS before it has answered, and reports that as
          // a timeout the user cannot distinguish from a wrong host.
          timeoutMs: 30_000,
          ...req(scope, undefined, options),
        }),
      test: (id, scope, options) =>
        call<ConnectionTestResult>(`/api/connections/${id}/test`, {
          method: "POST",
          ...req(scope, undefined, options),
        }),
    },

    approvals: {
      list: ({ workspaceId, environmentId, page, pageSize, status } = {}, options) =>
        call<Paged<Approval>>("/api/approvals", req({ workspaceId, environmentId }, contracts.approvalPage, options, { page, pageSize, status })),
      approve: (id, scope, options) =>
        call<unknown>(`/api/approvals/${id}/approve`, {
          method: "POST",
          body: { decidedBy: "ui" },
          ...req(scope, undefined, options),
        }),
      reject: (id, reason, scope, options) =>
        call<unknown>(`/api/approvals/${id}/reject`, {
          method: "POST",
          body: { decidedBy: "ui", reason },
          ...req(scope, undefined, options),
        }),
    },

    incidents: {
      list: ({ workspaceId, environmentId, ...query } = {}, options) =>
        call<FailureIncident[]>(
          "/api/failure-incidents",
          req(
            { workspaceId, environmentId },
            contracts.failureIncidentList,
            options,
            query as RequestOptions["query"],
          ),
        ),
      get: (id, scope, options) =>
        call<FailureIncident>(`/api/failure-incidents/${id}`, req(scope, contracts.failureIncident, options)),
      resolve: (id, scope, options) =>
        call<unknown>(`/api/failure-incidents/${id}/mark-resolved`, { method: "POST", ...req(scope, undefined, options) }),
      resolveAll: (scope, options) =>
        call<{ resolved: number }>("/api/failure-incidents/mark-all-resolved", { method: "POST", ...req(scope, undefined, options) }),
    },

    schedules: {
      list: (scope, options) =>
        call<Schedule[]>("/api/schedules", req(scope, contracts.scheduleList, options)),
      setEnabled: (id, enabled, scope, options) =>
        call<unknown>(`/api/schedules/${id}`, {
          method: "PATCH",
          body: { enabled },
          ...req(scope, undefined, options),
        }),
    },

    debug: {
      nodes: (runId, scope, options) =>
        call<NodeDebugSummary[]>(
          `/api/workflow-runs/${runId}/debug/nodes`,
          req(scope, contracts.nodeDebugSummaryList, options),
        ),
      node: (runId, nodeId, scope, options) =>
        call<NodeDebugDetail>(
          `/api/workflow-runs/${runId}/debug/nodes/${nodeId}`,
          req(scope, contracts.nodeDebugDetail, options),
        ),
    },
  };
}
