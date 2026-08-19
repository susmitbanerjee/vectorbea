import { contracts } from "@vectorbea/shared";
import type { Workspace } from "~/mocks/shell";

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

export interface VectorbeaClient {
  readonly transport: Transport;

  me(options?: RequestOptions): Promise<CurrentUser>;
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
    cancel(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
    retry(id: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
    retryNode(id: string, nodeId: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
  };

  workflows: {
    list(params?: Scope & PageParams, options?: RequestOptions): Promise<Paged<Workflow>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<Workflow>;
    versions(id: string, scope?: Scope, options?: RequestOptions): Promise<WorkflowVersion[]>;
    run(id: string, input?: unknown, scope?: Scope, options?: RequestOptions): Promise<unknown>;
    update(id: string, patch: Record<string, unknown>, scope?: Scope, options?: RequestOptions): Promise<Workflow>;
    delete(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
  };

  agents: {
    list(params?: Scope & PageParams, options?: RequestOptions): Promise<Paged<Agent>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<Agent>;
    update(id: string, patch: Record<string, unknown>, scope?: Scope, options?: RequestOptions): Promise<Agent>;
    delete(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
  };

  tools: {
    list(params?: Scope & PageParams, options?: RequestOptions): Promise<Paged<Tool>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<Tool>;
    update(id: string, patch: Record<string, unknown>, scope?: Scope, options?: RequestOptions): Promise<Tool>;
    delete(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
  };

  connections: {
    list(params?: Scope & PageParams, options?: RequestOptions): Promise<Paged<Connection>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<Connection>;
    test(id: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
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
      versions: (id, scope, options) =>
        call<WorkflowVersion[]>(
          `/api/workflows/${id}/versions`,
          req(scope, undefined, options),
        ),
      run: (id, input, scope, options) =>
        call<unknown>(`/api/workflows/${id}/run`, {
          method: "POST",
          body: input ?? {},
          ...req(scope, undefined, options),
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

    agents: {
      list: ({ workspaceId, environmentId, page, pageSize } = {}, options) =>
        call<Paged<Agent>>(
          "/api/agents",
          req({ workspaceId, environmentId }, contracts.agentPage, options, { page, pageSize }),
        ),
      get: (id, scope, options) =>
        call<Agent>(`/api/agents/${id}`, req(scope, contracts.agent, options)),
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
      test: (id, scope, options) =>
        call<unknown>(`/api/connections/${id}/test`, {
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
