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
type RunEvent = contracts.RunEvent;
type Workflow = contracts.Workflow;
type WorkflowVersion = contracts.WorkflowVersion;
type Agent = contracts.Agent;
type Tool = contracts.Tool;
type ToolVersion = contracts.ToolVersion;
type SpecImport = contracts.SpecImport;
type SpecImportResult = contracts.SpecImportResult;
type SpecOperation = contracts.SpecOperation;
type SpecDiff = contracts.SpecDiff;
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

/** One row of `GET /api/environments`. */
export interface EnvironmentSummary {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  type: string;
}

/**
 * `GET /api/environments` — the environments of the workspace in the header,
 * and only those.
 *
 * This is the endpoint the integration notes recorded as missing, and its
 * absence is what made every write surface guess. `defaultEnvironmentId` is the
 * one a write lands in when none is named, so a caller never has to infer it
 * from list order.
 */
export interface EnvironmentList {
  items: EnvironmentSummary[];
  total: number;
  defaultEnvironmentId: string;
}

/** One column, as `information_schema` describes it. */
export interface SchemaColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string | null;
  maxLength: number | null;
}

export interface SchemaTable {
  schema: string;
  table: string;
  tableType: "TABLE" | "VIEW";
  rowCountEstimate: number | null;
  columns: SchemaColumn[];
}

/**
 * What a database actually contains, read from `information_schema` only.
 *
 * Structure, never rows. This is what lets the tool builder offer real tables
 * and real columns instead of asking someone to remember them and write SQL.
 */
export interface SchemaPreviewResult {
  schemas: string[];
  tables: SchemaTable[];
  provider: string;
  databaseName: string | null;
  fetchedAt: string;
}

/**
 * `POST /api/workflows/:id/run`, as `RunRoutes.triggerRun` declares it.
 *
 * `mode` is the one that matters: "simulation" executes the graph without
 * touching a live connection, "real" is the real thing and is separately gated
 * per workspace (`REAL_EXECUTION_NOT_ENABLED`). It defaults to "simulation"
 * SERVER-SIDE, so omitting it is safe but never obvious — every caller here
 * states it.
 */
/**
 * One resolved entitlement, exactly as `Entitlement.toMap()` writes it.
 *
 * ── ONE `value`, NOT FOUR TYPED FIELDS ──────────────────────────────────────
 * The Kotlin record carries `intValue`, `boolValue`, `numValue` and `textValue`
 * and serialises exactly ONE of them, under the name `value`, chosen by `kind`.
 * Mirroring the record rather than the wire here would have produced a client
 * where every field is permanently null and every gate therefore permanently
 * open — the failure mode that looks like a working feature flag right up until
 * somebody on Free uses a Pro feature.
 *
 * `unlimited` is present for quota and limit rows only, and is the catalogue's
 * `-1`. It is NOT the same as a value of zero: zero is a real ceiling of zero,
 * and collapsing the two turns a seeding mistake into a free upgrade.
 */
export interface Entitlement {
  key: string;
  kind: "quota" | "limit" | "feature" | "setting";
  scope: "account" | "workspace";
  period?: string;
  /** "plan" or "override" — why this workspace has this value. */
  source: string;
  value: number | boolean | string | null;
  /** Quota and limit rows only. True when the catalogue says `-1`. */
  unlimited?: boolean;
}

/** The plan a workspace's account is on, as `PlanSummary.toMap()` writes it. */
export interface ResolvedPlan {
  code: string;
  name: string;
  priceCents: number | null;
  currency: string;
  billingInterval: string;
  priceModel: string;
  status: string;
  upgradeTo: string | null;
  upgradeToName: string | null;
  upgradeUrl: string;
}

export interface EntitlementsResponse {
  workspaceId?: string;
  accountId?: string;
  plan?: ResolvedPlan;
  seatsPurchased?: number;
  graceUntil?: string | null;
  entitlements?: Entitlement[];
  usage?: { periodStart?: string; periodEnd?: string; metrics?: Record<string, number> };
  counts?: Record<string, number>;
  seats?: { purchased?: number | null; used?: number | null; max?: number | null };
  [key: string]: unknown;
}

/** A row from `GET /api/plans` — the public catalogue, read straight from `plans`. */
export interface PlanSummary {
  code: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  currency: string | null;
  billingInterval: string | null;
  priceModel: string | null;
  upgradeTo: string | null;
  upgradeUrl: string | null;
  sortOrder: number;
  entitlements: {
    key: string;
    kind: string;
    scope: string;
    period: string | null;
    /** Already humanised by `EntitlementKeys.label` on the server. */
    label: string;
    value: number | boolean | string | null;
  }[];
}

export interface TriggerRunBody {
  input?: Record<string, unknown>;
  mode?: "simulation" | "real";
  triggerType?: "manual" | "api" | "schedule";
  /** Replays the same run instead of starting a second one. */
  idempotencyKey?: string;
}

/** The 202 body. Queue fields are absent when the run starts immediately. */
export interface TriggeredRun {
  runId: string;
  status: string;
  queuePosition?: number;
  etaSeconds?: number;
  idempotencyHit?: boolean;
}

export interface VectorbeaClient {
  readonly transport: Transport;

  me(options?: RequestOptions): Promise<CurrentUser>;
  bootstrap(options?: RequestOptions): Promise<BootstrapIds>;
  environments(scope?: Scope, options?: RequestOptions): Promise<EnvironmentList>;
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
    /**
     * `GET /api/runs/:id/events` — the run's own event log.
     *
     * This is the only server-side record of what a run actually did, step by
     * step. The endpoint accepts up to 500 per page precisely because a
     * parallel run emits more than the generic 100 cap and the tail is the part
     * anybody reading a failure needs.
     */
    events(
      id: string,
      params?: Scope & PageParams & { afterSequence?: number; type?: string },
      options?: RequestOptions,
    ): Promise<Paged<RunEvent>>;
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
    /**
     * Start a run. Returns the run id, which is the only way to watch it.
     *
     * This used to be typed `Promise<unknown>` and every caller discarded it,
     * so a run that the API refused — no published version, real execution
     * disabled, daily limit reached, queue down — looked exactly like a run
     * that started.
     */
    run(
      id: string,
      body?: TriggerRunBody,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<TriggeredRun>;
    /**
     * `POST /api/workflows/:id/runs/debug`.
     *
     * Executes against live connections exactly as `run` does, and additionally
     * records every node's inputs and outputs for `debug.nodes`. It is a
     * separate endpoint, not a flag, because it is a separate decision.
     */
    startDebugRun(
      id: string,
      input?: Record<string, unknown>,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<TriggeredRun>;
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
    /** `GET /api/tools/:id/versions` — the definition's history. */
    versions(id: string, scope?: Scope, options?: RequestOptions): Promise<{
      currentVersion?: number | null; toolName: string; items: ToolVersion[];
    }>;
  };

  /**
   * Import an API document, and turn its operations into tools.
   *
   * Three steps rather than one, deliberately: importing lists nine hundred
   * GitHub operations and creates NOTHING, and a second call creates the four
   * somebody actually wants. An import that created nine hundred tools would
   * have made the registry unusable in one click, with no undo.
   */
  toolSpecs: {
    /**
     * `POST /api/tool-specs/import` — fetch or accept a document.
     *
     * Exactly one of `url` and `document`. A URL is fetched SERVER-side (so it
     * needs no CORS, and so the SSRF guard applies, including across redirects);
     * `document` is for a file the person has on disk, and is bounded by the
     * API's request-body cap rather than the larger document cap.
     */
    import(
      body: { name?: string; url?: string; document?: string; connectionId?: string | null; previousImportId?: string },
      scope?: Scope, options?: RequestOptions,
    ): Promise<SpecImportResult>;
    list(params?: Scope & PageParams, options?: RequestOptions): Promise<Paged<SpecImport>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<SpecImport>;
    operations(
      id: string, params?: { tag?: string; q?: string },
      scope?: Scope, options?: RequestOptions,
    ): Promise<{ items: SpecOperation[]; tags: string[]; total: number }>;
    /** `GET /api/tool-specs/:id/diff` — what a re-import changed. */
    diff(id: string, previousImportId?: string, scope?: Scope, options?: RequestOptions): Promise<SpecDiff>;
    /**
     * `POST /api/tool-specs/:id/tools` — selected operations become tools.
     *
     * An operation that ALREADY backs a tool does not overwrite it: it produces
     * a pending version for review, in `pendingReview`. Re-selecting forty
     * operations must not be a silent mass edit of forty granted tools.
     */
    createTools(
      id: string, body: { operationKeys: string[]; connectionId?: string | null },
      scope?: Scope, options?: RequestOptions,
    ): Promise<contracts.SpecToolsCreated>;
    attachConnection(id: string, connectionId: string | null, scope?: Scope, options?: RequestOptions): Promise<void>;
  };

  /** The review queue. The only place a pending definition becomes live. */
  toolVersions: {
    pending(scope?: Scope, options?: RequestOptions): Promise<{
      items: contracts.PendingToolVersion[]; total: number; grantedCount: number;
    }>;
    get(versionId: string, scope?: Scope, options?: RequestOptions): Promise<ToolVersion>;
    apply(versionId: string, scope?: Scope, options?: RequestOptions): Promise<{ applied: boolean; message: string }>;
    reject(versionId: string, scope?: Scope, options?: RequestOptions): Promise<{ rejected: boolean; message: string }>;
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
    /**
     * Read a saved database connection's schemas, tables and columns.
     *
     * Metadata only - no row data ever crosses this boundary.
     */
    schemaPreview(id: string, scope?: Scope, options?: RequestOptions): Promise<SchemaPreviewResult>;
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
    /**
     * `DELETE /api/failure-incidents/:id` — removes the record.
     *
     * Distinct from `resolve`, which closes it and leaves the signature row on
     * the page forever. Purging used to be resolve-only, so an incident raised
     * by a misconfiguration during setup could never be got rid of.
     */
    remove(id: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
    /** `POST /api/failure-incidents/delete-resolved` — clears what is closed. */
    deleteResolved(scope?: Scope, options?: RequestOptions): Promise<{ deleted: number }>;
  };

  /**
   * What this WORKSPACE is entitled to.
   *
   * The subject is the workspace, never the reader — a Pro member inside a Free
   * workspace gets Free, which is the same answer every enforcement point in the
   * API gives. That is the whole reason the UI reads this instead of keeping its
   * own table of what each plan includes: a gate built from a local table
   * disagrees with the API the first time somebody raises a limit in the
   * database, and it disagrees by PROMISING something the API then refuses.
   */
  entitlements: {
    get(scope?: Scope, options?: RequestOptions): Promise<EntitlementsResponse>;
    /** The public catalogue, for the upgrade path on a disabled control. */
    plans(options?: RequestOptions): Promise<PlanSummary[]>;
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

    environments: (scope, options) =>
      call<EnvironmentList>("/api/environments", req(scope, undefined, options)),

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
      events: (id, { workspaceId, environmentId, page, pageSize, afterSequence, type } = {}, options) =>
        call<Paged<RunEvent>>(
          `/api/runs/${id}/events`,
          req({ workspaceId, environmentId }, contracts.runEventPage, options, {
            page,
            pageSize: pageSize ?? 200,
            afterSequence,
            type,
          }),
        ),
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
      run: (id, body, scope, options) =>
        call<TriggeredRun>(`/api/workflows/${id}/run`, {
          method: "POST",
          body: {
            input: body?.input ?? {},
            // Stated rather than defaulted: the server's own default is
            // "simulation", and a caller that means "real" and forgets would
            // silently get a simulation that looks like a successful run.
            mode: body?.mode ?? "simulation",
            triggerType: body?.triggerType ?? "manual",
            ...(body?.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {}),
          },
          ...req(scope, undefined, options),
        }),
      startDebugRun: (id, input, scope, options) =>
        call<TriggeredRun>(`/api/workflows/${id}/runs/debug`, {
          method: "POST",
          body: { input: input ?? {} },
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
      versions: (id, scope, options) =>
        call(`/api/tools/${id}/versions`, req(scope, contracts.toolVersionList, options)),
    },

    toolSpecs: {
      import: (body, scope, options) =>
        call(`/api/tool-specs/import`, {
          method: "POST", body,
          /* A 12 MB document is fetched and parsed server-side, and GitHub's takes
             seconds. The default timeout is written for a row read. */
          ...req(scope, contracts.specImportResult, { timeoutMs: 120_000, ...options }),
        }),
      list: ({ workspaceId, environmentId, page, pageSize } = {}, options) =>
        call(`/api/tool-specs`, req({ workspaceId, environmentId }, contracts.specImportPage, options, { page, pageSize })),
      get: (id, scope, options) =>
        call(`/api/tool-specs/${id}`, req(scope, contracts.specImport, options)),
      operations: (id, params, scope, options) =>
        call(`/api/tool-specs/${id}/operations`, req(scope, contracts.specOperationList, options, {
          tag: params?.tag, q: params?.q,
        })),
      diff: (id, previousImportId, scope, options) =>
        call(`/api/tool-specs/${id}/diff`, req(scope, contracts.specDiff, options, { previousImportId })),
      createTools: (id, body, scope, options) =>
        call(`/api/tool-specs/${id}/tools`, {
          method: "POST", body,
          ...req(scope, contracts.specToolsCreated, { timeoutMs: 120_000, ...options }),
        }),
      attachConnection: (id, connectionId, scope, options) =>
        call<void>(`/api/tool-specs/${id}`, {
          method: "PATCH", body: { connectionId }, ...req(scope, undefined, options),
        }),
    },

    toolVersions: {
      pending: (scope, options) =>
        call(`/api/tool-versions/pending`, req(scope, contracts.pendingToolVersionList, options)),
      get: (versionId, scope, options) =>
        call(`/api/tool-versions/${versionId}`, req(scope, contracts.toolVersion, options)),
      apply: (versionId, scope, options) =>
        call(`/api/tool-versions/${versionId}/apply`, {
          method: "POST", body: {}, ...req(scope, undefined, options),
        }),
      reject: (versionId, scope, options) =>
        call(`/api/tool-versions/${versionId}/reject`, {
          method: "POST", body: {}, ...req(scope, undefined, options),
        }),
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
      schemaPreview: (id, scope, options) =>
        call<SchemaPreviewResult>(`/api/connections/${id}/schema-preview`, {
          method: "POST",
          body: {},
          // Introspection opens a real connection and runs several
          // information_schema queries over it. The 15s default abandons a cold
          // pooler mid-answer and reports it as a timeout the user cannot tell
          // apart from a wrong host.
          timeoutMs: 30_000,
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
      remove: (id, scope, options) =>
        call<unknown>(`/api/failure-incidents/${id}`, { method: "DELETE", ...req(scope, undefined, options) }),
      deleteResolved: (scope, options) =>
        call<{ deleted: number }>("/api/failure-incidents/delete-resolved", { method: "POST", ...req(scope, undefined, options) }),
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

    entitlements: {
      get: (scope, options) =>
        call<EntitlementsResponse>("/api/entitlements", req(scope, undefined, options)),
      /* Not workspace-scoped: the catalogue is the same for everybody, and
         scoping it would make the upgrade path a caller cannot see unless it
         already has a workspace — which is the one case where it matters most. */
      plans: async (options) => {
        const payload = await call<{ plans?: PlanSummary[] }>("/api/plans", { ...options });
        return payload?.plans ?? [];
      },
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
