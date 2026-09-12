import { contracts } from "@vectorbea/shared";
import type { HttpRequestPayload, HttpResponseResult } from "~/lib/tools/http-client";
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
  httpSpec?: Record<string, unknown>;
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
 * `POST /api/connections/:id/mcp/discover`, as `McpConnectorRoutes` declares it.
 *
 * `toolsFound` and `toolsWritten` are different numbers and both are reported:
 * found is what the server advertised, written is what reached the registry. A
 * gap between them is a partial write worth seeing rather than rounding away.
 */
export interface McpDiscoverResult {
  toolsFound: number;
  toolsWritten: number;
  /** How many descriptions the sanitizer altered. Surfaced, never only logged. */
  toolsFlagged: number;
  resourcesFound: number;
  fetchedAt: string;
  /** The last refresh failed and these tools came from the previous one. */
  stale: boolean;
  lastError: string | null;
  tools: { name: string; description: string | null; descriptionWasAltered: boolean }[];
}

/** One row of `mcp_tools_available`, as the API returns it. */
export interface McpToolRow {
  toolId: string;
  name: string;
  mcpToolName: string | null;
  description: string | null;
  serverName: string | null;
  lastSeenAt: string | null;
  /**
   * The server has not advertised this in a week.
   *
   * "Possibly" is the API's word and it is kept: a server down for eight days
   * has withdrawn nothing. The row keeps its grants either way.
   */
  possiblyWithdrawn: boolean;
  grantedToAgentIds: string[];
}

/** The manifest cache's health — a different fact from the tools themselves. */
export interface McpManifest {
  fetchedAt: string;
  lastError: string | null;
  lastErrorAt: string | null;
  stale: boolean;
  toolCount: number;
  resourceCount: number;
}

export interface McpToolsResponse {
  items: McpToolRow[];
  manifest: McpManifest | null;
  serverName: string;
}

/* ── Triggers ─────────────────────────────────────────────────────────────── */

/** One inbound webhook, as `WebhookRoutes.toResponse` returns it. */
export interface WebhookRow {
  id: string;
  workflowId: string;
  name: string;
  signatureScheme: string;
  /** True when a signing secret is stored. The secret itself is never returned. */
  signed: boolean;
  signatureHeader: string | null;
  timestampHeader: string | null;
  toleranceSeconds: number;
  inputMapping: Record<string, string>;
  eventTypePath: string | null;
  eventTypes: string[];
  dedupeHeader: string | null;
  dedupePath: string | null;
  runDedupPath: string | null;
  runPriority: number | null;
  enabled: boolean;
  createdAt: string;
  /** Present only on create and rotate. */
  url?: string;
}

export interface CreateWebhookBody {
  workflowId: string;
  name: string;
  signatureScheme?: string;
  /** Plaintext, exactly once. Stored encrypted; never returned. */
  signingSecret?: string | null;
  signatureHeader?: string | null;
  timestampHeader?: string | null;
  toleranceSeconds?: number;
  inputMapping?: Record<string, string>;
  eventTypePath?: string | null;
  eventTypes?: string[];
  dedupeHeader?: string | null;
  dedupePath?: string | null;
  runDedupPath?: string | null;
}

export interface WebhookDeliveryRow {
  id: string;
  receivedAt: string;
  /** `accepted`, `rejected`, `duplicate`, … — why the call did or did not run. */
  outcome: string;
  detail: string | null;
  headers: Record<string, string>;
  body: string | null;
  bodyBytes: number;
}

/** One broker subscription, as `EventTriggerRoutes.toResponse` returns it. */
export interface EventTriggerRow {
  id: string;
  workflowId: string;
  name: string;
  broker: string;
  connectionId: string | null;
  source: string;
  consumerGroup: string | null;
  inputMapping: Record<string, string>;
  filterPath: string | null;
  filterValues: string[];
  dedupePath: string | null;
  runDedupPath: string | null;
  runPriority: number | null;
  maxInFlight: number | null;
  batchSize: number | null;
  enabled: boolean;
  /** Why it stopped, if it did. The answer to "my events stopped arriving". */
  disabledReason: string | null;
  lastError: string | null;
  lastMessageAt: string | null;
  messagesConsumed: number;
  createdAt: string;
}

export interface CreateEventTriggerBody {
  workflowId: string;
  name: string;
  broker: string;
  connectionId?: string | null;
  source: string;
  consumerGroup?: string | null;
  inputMapping?: Record<string, string>;
  filterPath?: string | null;
  filterValues?: string[];
  dedupePath?: string | null;
  runDedupPath?: string | null;
}

/* ── Skills ───────────────────────────────────────────────────────────────── */

export interface SkillRow {
  id: string;
  workspaceId: string;
  environmentId: string;
  name: string;
  slug: string;
  description: string | null;
  /** `first_party` for a library install, `workspace` for one written here. */
  provenance: string;
  catalogEntryId: string | null;
  currentVersionId: string | null;
  currentVersion: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersionRow {
  id: string;
  skillId: string;
  version: number;
  name: string;
  summary: string | null;
  instructions: string;
  outputContract: string | null;
  examples: { title: string; body: string }[];
  requiredTools: { toolId: string; label: string }[];
  /**
   * The text tripped the frame-impersonation rules and was defanged.
   *
   * Surfaced, never hidden: the sanitizer does not reject, so a flagged version
   * is installed and composing, and the API saying so is the only way anybody
   * finds out.
   */
  flaggedForReview: boolean;
  changeSummary: string | null;
  createdAt: string;
}

export interface SkillCatalogRow {
  id: string;
  slug: string;
  version: number;
  name: string;
  summary: string | null;
  category: string | null;
  instructions: string;
  outputContract: string | null;
  examples: { title: string; body: string }[];
  /**
   * What this skill needs an agent to be able to DO, in the abstract.
   *
   * A library entry cannot name tool uuids — it has no workspace — so it names
   * capabilities, and installing binds each to a real tool. That binding is the
   * install's whole job.
   */
  requiredCapabilities: { key: string; label: string; why: string }[];
  provenance: string;
}

export interface InstallSkillBody {
  version?: number;
  slug?: string;
  /** capability key → tool uuid. Every declared capability must appear. */
  toolBindings: Record<string, string>;
}

export interface SkillGrantRow {
  skillId: string;
  skillName: string;
  skillVersionId: string | null;
  version: number | null;
}

/* ── API keys ─────────────────────────────────────────────────────────────── */

/**
 * A key as it can be LISTED, which is a deliberately thin row.
 *
 * `ApiKeyService` stores SHA-256 of the secret and nothing else. What survives
 * in clear is `prefix` — the first twelve characters — which is enough to match
 * a row to a log line and useless to whoever finds it. There is no field here
 * that could carry the secret, because there is no column that holds it: losing
 * a key means minting another, which is the right trade for a credential that
 * can spend money.
 */
export interface ApiKeyRow {
  id: string;
  name: string;
  /** First twelve characters. Identifies, never authenticates. */
  prefix: string;
  /**
   * The member this key spends as, by email, or null for a service key.
   *
   * Not decoration. A key is charged against its creator's member cap, so a
   * guest who mints one is still held to the budget their host set — "make an
   * API key" is a different door into the same allowance, never a bigger one.
   */
  actsAs: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ApiKeyListResponse {
  keys: ApiKeyRow[];
  /** The plan's ceiling on how many keys this workspace may hold. */
  limit: number | null;
  used: number;
  rateLimitPerMinute: number;
}

/** The response to a mint or a rotate. The ONLY time `secret` exists. */
export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  /**
   * The secret, once.
   *
   * Named `secret` rather than `key` upstream so that a client logging the whole
   * response is at least obvious about what it has just written to disk. The
   * rotate endpoint spells the same value `key`; both are normalised here so a
   * caller never has to know which it called.
   */
  secret: string;
  expiresAt?: string | null;
  /** Present on a rotate: the key this one replaces. */
  rotatedFrom?: string | null;
  /** Upstream's own sentence — when the old key stops working, in words. */
  message?: string;
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
    /**
     * `GET /api/runs/:id/waits` — what the run is parked on, right now.
     *
     * Only worth calling while the run is parked; a finished run has no active
     * waits and the endpoint correctly returns none. The completed spans live in
     * the event log instead.
     */
    waits(id: string, scope?: Scope, options?: RequestOptions): Promise<Paged<contracts.RunWait>>;
    /**
     * `GET /api/runs/:id/deliveries` — where the result went.
     *
     * Read on every finished run, not only failed ones: "delivered" is the
     * answer somebody is looking for as often as "not delivered".
     */
    deliveries(id: string, scope?: Scope, options?: RequestOptions):
        Promise<{ items: contracts.RunDelivery[]; total: number; deliveryStatus: string }>;
    /** `POST /api/deliveries/:id/redeliver` — try again, with the same key. */
    redeliver(deliveryId: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
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
    testHttpRequest(body: HttpRequestPayload, scope?: Scope, options?: RequestOptions): Promise<HttpResponseResult>;
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
    /**
     * Ask an MCP server what it offers, and register each tool it names.
     *
     * Writes one `tools` row per remote tool. It does NOT grant anything —
     * granting is per tool, on an agent, and there is deliberately no call here
     * or anywhere that could express "every tool from this server".
     */
    mcpDiscover(id: string, scope?: Scope, options?: RequestOptions): Promise<McpDiscoverResult>;
    /** What this server has advertised, including what it has stopped advertising. */
    mcpTools(id: string, scope?: Scope, options?: RequestOptions): Promise<McpToolsResponse>;
  };
  schedules: {
    list(scope?: Scope, options?: RequestOptions): Promise<Schedule[]>;
    setEnabled(id: string, enabled: boolean, scope?: Scope, options?: RequestOptions): Promise<unknown>;
  };

  /**
   * Inbound webhooks — the "something happened over there" trigger.
   *
   * Shipped on the API since the beginning with no client and no screen, so the
   * only way to start a workflow from a third party was to read the route
   * handler. See `WebhookRoutes`.
   */
  webhooks: {
    list(params?: Scope & { workflowId?: string }, options?: RequestOptions): Promise<{ items: WebhookRow[]; total: number }>;
    /**
     * Returns the row WITH its url — the only time it is ever returned.
     *
     * A webhook url is pasted into somebody else's console, which makes it a
     * bearer credential for "may enqueue work in this workspace" even with a
     * signature on top. It appears on create and on rotate and nowhere else, so
     * the caller has to keep it or rotate again.
     */
    create(body: CreateWebhookBody, scope?: Scope, options?: RequestOptions): Promise<WebhookRow & { url: string }>;
    remove(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
    setEnabled(id: string, enabled: boolean, scope?: Scope, options?: RequestOptions): Promise<unknown>;
    /** Issues a new token and invalidates the old one. Returns the new url, once. */
    rotate(id: string, scope?: Scope, options?: RequestOptions): Promise<{ url: string }>;
    deliveries(id: string, params?: Scope & PageParams, options?: RequestOptions): Promise<Paged<WebhookDeliveryRow>>;
    replay(id: string, deliveryId: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
  };

  /** Broker subscriptions — Kafka, SQS, Pub/Sub. See `EventTriggerRoutes`. */
  eventTriggers: {
    list(params?: Scope & { workflowId?: string }, options?: RequestOptions): Promise<{ items: EventTriggerRow[]; total: number }>;
    create(body: CreateEventTriggerBody, scope?: Scope, options?: RequestOptions): Promise<EventTriggerRow>;
    remove(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
    setEnabled(id: string, enabled: boolean, scope?: Scope, options?: RequestOptions): Promise<unknown>;
  };

  /**
   * Skills: the first-party library, a workspace's installed bundles, and the
   * per-agent grant.
   *
   * `setGrants` is the one that matters. It REFUSES a grant whose skill needs a
   * tool the agent does not hold, and the refusal carries the missing list —
   * see `SkillToolsMissing`. That refusal is the feature, not an obstacle: the
   * alternative is an agent that does exactly what its skill taught it, gets
   * refused by the runtime, and presents as one that hallucinated a tool.
   */
  skills: {
    list(params?: Scope & { status?: string } & PageParams, options?: RequestOptions): Promise<Paged<SkillRow>>;
    get(id: string, scope?: Scope, options?: RequestOptions): Promise<SkillRow & { currentVersionDetail?: SkillVersionRow }>;
    archive(id: string, scope?: Scope, options?: RequestOptions): Promise<unknown>;
    holders(id: string, scope?: Scope, options?: RequestOptions): Promise<{ items: { agentId: string; agentName: string }[] }>;
    catalog(scope?: Scope, options?: RequestOptions): Promise<{ items: SkillCatalogRow[] }>;
    /** Copies a library entry into this workspace, binding its capabilities to real tools. */
    install(slug: string, body: InstallSkillBody, scope?: Scope, options?: RequestOptions): Promise<SkillRow>;
    grants(agentId: string, scope?: Scope, options?: RequestOptions): Promise<{ items: SkillGrantRow[] }>;
    setGrants(agentId: string, skillIds: string[], scope?: Scope, options?: RequestOptions): Promise<unknown>;
  };

  /**
   * Workspace API credentials — `ApiKeyRoutes`.
   *
   * ── THIS IS NOT THE ROUTE THE APP USED TO CALL ──────────────────────────
   * `/app/api/keys` writes to a Supabase `api_keys` table that no environment
   * points at any more, so the screen it backs could list nothing and mint
   * nothing while reporting success. The live store is Postgres, behind the
   * Kotlin API, and it is the same table `authenticate()` reads — which is the
   * only property that makes a minted key actually work.
   *
   * `create` and `rotate` are the only calls that ever return a secret, and
   * they return it once. Nothing here can read one back.
   */
  apiKeys: {
    list(scope?: Scope, options?: RequestOptions): Promise<ApiKeyListResponse>;
    create(
      body: { name: string; actsAs?: string | null; expiresAt?: string | null },
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<CreatedApiKey>;
    /**
     * Mint a replacement and start a bounded clock on the old one.
     *
     * Not "revoke then create": that is an outage between the revoke and the
     * new key reaching every deployment holding it, and "rotate your keys
     * regularly" is advice nobody follows twice after that happens once.
     */
    rotate(
      id: string,
      graceSeconds?: number,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<CreatedApiKey>;
    revoke(id: string, scope?: Scope, options?: RequestOptions): Promise<void>;
    /** Null clears this key's own ceiling and leaves only the plan's. */
    setRateLimit(
      id: string,
      perMinute: number | null,
      scope?: Scope,
      options?: RequestOptions,
    ): Promise<{ planCeiling: number; message: string }>;
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
      waits: (id, scope, options) =>
        call<Paged<contracts.RunWait>>(
          `/api/runs/${id}/waits`,
          req(scope, contracts.runWaitPage, options),
        ),
      deliveries: (id, scope, options) =>
        call<{ items: contracts.RunDelivery[]; total: number; deliveryStatus: string }>(
          `/api/runs/${id}/deliveries`,
          req(scope, contracts.runDeliveryList, options),
        ),
      redeliver: (deliveryId, scope, options) =>
        call<unknown>(
          `/api/deliveries/${deliveryId}/redeliver`,
          { ...req(scope, undefined, options), method: "POST" },
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
      testHttpRequest: (body, scope, options) =>
        call<HttpResponseResult>("/api/connections/test-http-request", {
          method: "POST", body, ...req(scope, undefined, { timeoutMs: 35_000, ...options }),
        }),
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
      mcpDiscover: (id, scope, options) =>
        call<McpDiscoverResult>(`/api/connections/${id}/mcp/discover`, {
          method: "POST",
          body: {},
          // A JSON-RPC round trip to somebody else's server, then a write per
          // tool. The 15s default abandons a slow customer server and reports a
          // timeout that reads as "discovery is broken".
          timeoutMs: 30_000,
          ...req(scope, undefined, options),
        }),
      mcpTools: (id, scope, options) =>
        call<McpToolsResponse>(`/api/connections/${id}/mcp/tools`, req(scope, undefined, options)),
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

    webhooks: {
      list: ({ workspaceId, environmentId, workflowId } = {}, options) =>
        call<{ items: WebhookRow[]; total: number }>(
          "/api/webhooks",
          req({ workspaceId, environmentId }, undefined, options, { workflowId }),
        ),
      create: (body, scope, options) =>
        call<WebhookRow & { url: string }>("/api/webhooks", {
          method: "POST", body, ...req(scope, undefined, options),
        }),
      remove: (id, scope, options) =>
        call<void>(`/api/webhooks/${id}`, { method: "DELETE", ...req(scope, undefined, options) }),
      /* Two endpoints, not a PATCH with a flag — that is how the API models it,
         and mirroring it keeps the audit trail one action per row. */
      setEnabled: (id, enabled, scope, options) =>
        call<unknown>(`/api/webhooks/${id}/${enabled ? "enable" : "disable"}`, {
          method: "POST", body: {}, ...req(scope, undefined, options),
        }),
      rotate: (id, scope, options) =>
        call<{ url: string }>(`/api/webhooks/${id}/rotate`, {
          method: "POST", body: {}, ...req(scope, undefined, options),
        }),
      deliveries: (id, { workspaceId, environmentId, page, pageSize } = {}, options) =>
        call<Paged<WebhookDeliveryRow>>(
          `/api/webhooks/${id}/deliveries`,
          req({ workspaceId, environmentId }, undefined, options, { page, pageSize }),
        ),
      replay: (id, deliveryId, scope, options) =>
        call<unknown>(`/api/webhooks/${id}/deliveries/${deliveryId}/replay`, {
          method: "POST", body: {}, ...req(scope, undefined, options),
        }),
    },

    eventTriggers: {
      list: ({ workspaceId, environmentId, workflowId } = {}, options) =>
        call<{ items: EventTriggerRow[]; total: number }>(
          "/api/event-triggers",
          req({ workspaceId, environmentId }, undefined, options, { workflowId }),
        ),
      create: (body, scope, options) =>
        call<EventTriggerRow>("/api/event-triggers", {
          method: "POST", body, ...req(scope, undefined, options),
        }),
      remove: (id, scope, options) =>
        call<void>(`/api/event-triggers/${id}`, { method: "DELETE", ...req(scope, undefined, options) }),
      setEnabled: (id, enabled, scope, options) =>
        call<unknown>(`/api/event-triggers/${id}/${enabled ? "enable" : "disable"}`, {
          method: "POST", body: {}, ...req(scope, undefined, options),
        }),
    },

    skills: {
      list: ({ workspaceId, environmentId, status, page, pageSize } = {}, options) =>
        call<Paged<SkillRow>>(
          "/api/skills",
          req({ workspaceId, environmentId }, undefined, options, { status, page, pageSize }),
        ),
      get: (id, scope, options) =>
        call<SkillRow & { currentVersionDetail?: SkillVersionRow }>(
          `/api/skills/${id}`, req(scope, undefined, options),
        ),
      archive: (id, scope, options) =>
        call<unknown>(`/api/skills/${id}`, { method: "DELETE", ...req(scope, undefined, options) }),
      holders: (id, scope, options) =>
        call<{ items: { agentId: string; agentName: string }[] }>(
          `/api/skills/${id}/agents`, req(scope, undefined, options),
        ),
      catalog: (scope, options) =>
        call<{ items: SkillCatalogRow[] }>("/api/skill-catalog", req(scope, undefined, options)),
      install: (slug, body, scope, options) =>
        call<SkillRow>(`/api/skill-catalog/${slug}/install`, {
          method: "POST", body, ...req(scope, undefined, options),
        }),
      grants: (agentId, scope, options) =>
        call<{ items: SkillGrantRow[] }>(`/api/agents/${agentId}/skills`, req(scope, undefined, options)),
      /*
       * PUT, and it REPLACES the list — the API models grants as a set, not as
       * a stream of adds and removes, so a caller that sent only the new one
       * would silently revoke the rest. Every call sends the whole intended set.
       */
      setGrants: (agentId, skillIds, scope, options) =>
        call<unknown>(`/api/agents/${agentId}/skills`, {
          method: "PUT",
          body: { skills: skillIds.map((skillId) => ({ skillId })) },
          ...req(scope, undefined, options),
        }),
    },

    apiKeys: {
      list: (scope, options) =>
        call<ApiKeyListResponse>("/api/api-keys", req(scope, undefined, options)),

      create: (body, scope, options) =>
        call<CreatedApiKey>("/api/api-keys", {
          method: "POST",
          /*
           * `actsAs` is OMITTED, not sent as null, when the caller does not
           * name one. The route reads the three cases apart: absent means "the
           * person minting it", an empty string means an unattributed service
           * key, and a uuid means that member. Sending null for "I did not
           * choose" would mint an unattributed key — one charged to the
           * workspace and to nobody's cap — which is the opposite of the
           * default and is exactly how a guest would escape their budget.
           */
          body: {
            name: body.name,
            ...(body.actsAs === undefined ? {} : { actsAs: body.actsAs }),
            ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
          },
          ...req(scope, undefined, options),
        }),

      rotate: async (id, graceSeconds, scope, options) => {
        /* Upstream calls the secret `key` here and `secret` on create. Same
           value, same one-and-only-showing; normalised so a caller does not
           have to remember which endpoint it reached. */
        const payload = await call<CreatedApiKey & { key?: string }>(
          `/api/api-keys/${id}/rotate`,
          {
            method: "POST",
            body: {},
            ...req(
              scope, undefined, options,
              graceSeconds == null ? undefined : { graceSeconds },
            ),
          },
        );
        return { ...payload, secret: payload.secret ?? payload.key ?? "" };
      },

      revoke: (id, scope, options) =>
        call<void>(`/api/api-keys/${id}`, {
          method: "DELETE",
          ...req(scope, undefined, options),
        }),

      setRateLimit: (id, perMinute, scope, options) =>
        call<{ planCeiling: number; message: string }>(`/api/api-keys/${id}/rate-limit`, {
          method: "PUT",
          body: { perMinute },
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
