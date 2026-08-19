import { z } from "zod";
import { isoDateTime, jsonObject, uuid } from "./primitives";

/**
 * Approvals, failure incidents, workers, control metrics, debug snapshots.
 *
 * Transcribed from `routes/{ApprovalRoutes,WorkerRoutes,ControlMetricsRoutes,
 * DebugRoutes}.kt` and `recovery/FailureIncidentRoutes.kt`.
 */

/* ── Approvals ────────────────────────────────────────────────────────────── */

/**
 * IMPORTANT: this reads the LEGACY `approvals` table.
 *
 * V027 migrated `run_approvals` to be authoritative and added the columns P13
 * needs — `sla_deadline_at`, `escalation_policy_json`, `decision_context_json`
 * (resolved values, not templates), `confidence_score`. `ApprovalRepository`
 * still queries the old `approvals` table, so NONE of those four reach the API.
 *
 * The approvals screen is designed around exactly those fields. This is the
 * single largest shape gap in the audit; see API-GAPS.md.
 */
export const approval = z.object({
  id: uuid,
  runId: uuid,
  workflowId: uuid,
  stepId: z.string().nullable(),
  nodeId: z.string().nullable(),
  agentId: uuid.nullable(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  title: z.string().nullable(),
  message: z.string().nullable(),
  riskLevel: z.string().nullable(),
  requestedBy: z.string().nullable(),
  decidedBy: z.string().nullable(),
  requestedAt: isoDateTime,
  decidedAt: isoDateTime.nullable(),
  decisionReason: z.string().nullable(),
  payloadJsonSanitized: jsonObject.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Approval = z.infer<typeof approval>;

/* ── Failure incidents ────────────────────────────────────────────────────── */

/**
 * `GET /api/failure-incidents` returns a FLAT array — not a page envelope, and
 * not grouped. Filters are `status`, `category`, `limit`.
 *
 * The Incidents screen clusters by failure signature. There is no group-by
 * endpoint, so clustering is either client-side over at most `limit` rows (which
 * silently under-counts) or it does not ship. See API-GAPS.md.
 */
export const failureIncident = z.object({
  id: uuid,
  runId: uuid,
  workflowId: uuid,
  failedNodeId: z.string().nullish(),
  failedStepId: z.string().nullish(),
  failedAgentId: uuid.nullish(),
  failedToolId: uuid.nullish(),
  failedConnectionId: uuid.nullish(),
  category: z.string(),
  code: z.string(),
  severity: z.string(),
  summary: z.string(),
  technicalSummary: z.string().nullish(),
  recommendedAction: z.string().nullish(),
  retryable: z.boolean(),
  autoReplaySafe: z.boolean(),
  requiresHumanApproval: z.boolean(),
  /**
   * A JSON-encoded STRING, not an object.
   *
   * `FailureIncidentRoutes` puts the already-serialised `remediation_json`
   * column straight into the response map, so it arrives double-encoded. The
   * union accepts both so this keeps working if the route is ever fixed to send
   * a real object; callers must handle the string case today.
   */
  remediationJson: z.union([jsonObject, z.string()]).nullish(),
  detectedAt: isoDateTime,
  resolutionStatus: z.string(),
});
export type FailureIncident = z.infer<typeof failureIncident>;

export const failureIncidentList = z.array(failureIncident);

/* ── Workers / fleet ──────────────────────────────────────────────────────── */

/**
 * `GET /api/workers` returns a flat array.
 *
 * `heartbeat` is a pre-rendered relative string ("40s ago", "2h ago"), not a
 * timestamp. That means the UI cannot re-render it as it ages, cannot localise
 * it, and cannot sort by it — the freshness of a fleet view silently freezes at
 * whatever the server said. Recorded as a shape delta in API-GAPS.md.
 */
export const worker = z.object({
  id: z.string(),
  status: z.string(),
  queue: z.string().nullish(),
  activeTasks: z.number(),
  maxCapacity: z.number(),
  heartbeat: z.string().nullish(),
  version: z.string().nullish(),
  region: z.string().nullish(),
});
export type Worker = z.infer<typeof worker>;

export const workerList = z.array(worker);

/**
 * `GET /api/control/metrics`.
 *
 * `freshness` is the part worth keeping: it states how stale each block may be
 * (`"live"`, `"up to 15s (worker heartbeat interval)"`). A control screen that
 * shows a number without saying how old it is invites someone to act on a
 * fifteen-second-old fleet count during an incident.
 */
export const controlMetrics = z.object({
  workspace: z.object({
    queued: z.number(),
    queueByPriority: z.array(z.object({ priority: z.string(), depth: z.number() })),
    inFlight: z.number(),
    inFlightByClass: z.record(z.string(), z.number()).nullish(),
    maxConcurrentRuns: z.number().nullable(),
    utilisation: z.number().nullable(),
  }),
  fleet: z.object({
    workersAlive: z.number(),
    slotsTotal: z.number(),
    slotsAvailable: z.number(),
  }),
  waitReason: z.string().nullable(),
  freshness: z.record(z.string(), z.string()),
});
export type ControlMetrics = z.infer<typeof controlMetrics>;

/** `GET /api/control/activity` — newest durable run events for a workspace. */
export const controlActivityEvent = z.object({
  id: uuid,
  runId: uuid,
  type: z.string(),
  status: z.string().nullish(),
  source: z.string().nullish(),
  timestamp: isoDateTime,
  durationMs: z.number().nullish(),
  stepId: z.string().nullish(),
  title: z.string().nullish(),
  summary: z.string().nullish(),
  workflowName: z.string(),
});
export type ControlActivityEvent = z.infer<typeof controlActivityEvent>;
export const controlActivityList = z.array(controlActivityEvent);

/* ── Node debug snapshots ─────────────────────────────────────────────────── */

/**
 * `workflow_node_debug_snapshots` (V017) backs the I/O mapping inspector.
 * This one DOES exist end-to-end — table, repository and three endpoints.
 */
export const nodeDebugSummary = z.object({
  nodeId: z.string(),
  nodeType: z.string().nullable(),
  nodeName: z.string().nullable(),
  status: z.string(),
  attempt: z.number(),
  errorType: z.string().nullable(),
  humanFailureReason: z.string().nullable(),
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
  durationMs: z.number().nullable(),
  hasFailure: z.boolean(),
});
export type NodeDebugSummary = z.infer<typeof nodeDebugSummary>;

export const nodeDebugSummaryList = z.array(nodeDebugSummary);

/**
 * One `{{expression}}` in a node's input mapping, paired with what it resolved
 * to and where the value came from.
 *
 * Written by `WorkflowRuntime` (search `variableSources`). Two caveats the UI
 * must respect, both from the writer's own comment:
 *
 *  - The source node is a **guess**. It is recovered by regex from the template
 *    text (`{{steps.foo.bar}}` → `foo`) and matched against node ids and labels,
 *    not reported by the resolver itself. So provenance is a strong hint, not an
 *    authoritative link, and the UI must not render it as a guaranteed edge.
 *
 *  - `resolvedValue` is looked up per FIELD, not per expression. When one field
 *    interpolates two expressions, both rows carry the same whole-field value.
 *    Rendering them as separate resolved values would be wrong.
 */
export const variableSource = z.object({
  /** The literal template text, e.g. `{{steps.fetch.id}}`. */
  variable: z.string(),
  /** The input field this expression contributes to. */
  field: z.string(),
  resolvedValue: z.unknown().nullable(),
  /** Node label when it could be matched, otherwise the raw id from the template. */
  sourceNode: z.string().nullable(),
  sourcePath: z.string().nullable(),
  missing: z.boolean(),
});
export type VariableSource = z.infer<typeof variableSource>;

/**
 * The detail snapshot — what the I/O mapping preview needs, and it is all
 * present: the template BEFORE resolution, the resolved values, and where each
 * variable came from.
 *
 * Note `resolvedVariables` and `variableSources` are written from the SAME list
 * by the worker. They are not two views of the data; one of them is redundant.
 * The preview reads `variableSources`.
 */
export const nodeDebugDetail = z.object({
  id: uuid,
  workflowRunId: uuid,
  nodeId: z.string(),
  nodeType: z.string().nullable(),
  nodeName: z.string().nullable(),
  attempt: z.number(),
  status: z.string(),
  /** Field -> raw template string, before any interpolation. */
  inputTemplate: z.record(z.string(), z.unknown()).nullable(),
  /** Field -> resolved value, after interpolation. */
  resolvedInput: z.record(z.string(), z.unknown()).nullable(),
  /** Redundant duplicate of variableSources. See the note above. */
  resolvedVariables: z.array(variableSource).nullable(),
  variableSources: z.array(variableSource).nullable(),
  output: z.unknown().nullable(),
  parsedOutput: z.unknown().nullable(),
  schemaValidation: z.unknown().nullable(),
  errorType: z.string().nullable(),
  errorMessage: z.string().nullable(),
  humanFailureReason: z.string().nullable(),
  suggestedFix: z.string().nullable(),
  modelProvider: z.string().nullable(),
  modelName: z.string().nullable(),
  tokensInput: z.number().nullable(),
  tokensOutput: z.number().nullable(),
});
export type NodeDebugDetail = z.infer<typeof nodeDebugDetail>;
