import { z } from "zod";
import { isoDateTime, jsonObject, money, page, uuid } from "./primitives";

/**
 * Run contracts.
 *
 * Transcribed from `routes/RunRoutes.kt` — `AgentRun.toResponse()` and
 * `toDetailResponse()`.
 *
 * Status values come from the `agent_runs.status` column. The UI's fixture type
 * (`~/mocks/domain`) uses a DIFFERENT vocabulary — `awaiting-approval` with a
 * hyphen, `succeeded` rather than `completed`. That delta is real and is
 * recorded in API-GAPS.md; `toUiRunStatus` below is the single place it is
 * reconciled, so no screen has to know.
 */

/*
 * A NOTE ON `.nullish()` BELOW
 * ----------------------------
 * Several fields are `.nullish()` rather than `.nullable()`. That is not
 * defensive padding — it is what the API actually does.
 *
 * Every response is assembled as a Kotlin `mapOf(...)`, and Jackson's default
 * inclusion drops null entries rather than emitting `"field": null`. So an
 * absent value arrives as a MISSING KEY, and `z.string().nullable()` rejects a
 * missing key with "Required" — the whole response fails validation and the
 * transport raises `contract_mismatch`.
 *
 * That is why live data reached no screen: five of the eight endpoints the
 * Control page needs were failing validation before a component ever saw them.
 */

export const runStatus = z.enum([
  "queued",
  "running",
  "succeeded",
  "completed",
  "failed",
  "cancelled",
  "awaiting_approval",
  "waiting_for_approval",
  "waiting_for_timer",
  "recovering",
  "yielded",
  "cancellation_requested",
  "enqueue_failed",
  "continued_as_new",
  "paused",
  "timed_out",
]);
export type RunStatus = z.infer<typeof runStatus>;

export const triggerType = z.enum(["schedule", "webhook", "manual", "api"]);
export type TriggerType = z.infer<typeof triggerType>;

/**
 * A run as the LIST endpoint returns it.
 *
 * The list response includes the denormalized checkpoint ribbon and joined
 * workflow/environment labels needed by the Runs table. It intentionally does
 * not include full node payloads; `ribbonJson` is the compact [{n,s,ms}] shape
 * maintained transactionally by the worker.
 */
export const runSummary = z.object({
  id: uuid,
  workspaceId: uuid,
  environmentId: uuid,
  workflowId: uuid,
  workflowVersionId: uuid,
  status: runStatus,
  triggerType,
  currentStepId: z.string().nullish(),
  currentAgentId: uuid.nullish(),
  idempotencyKey: z.string().nullish(),
  startedAt: isoDateTime.nullish(),
  completedAt: isoDateTime.nullish(),
  durationMs: z.number().nullish(),
  totalTokens: z.number().nullish(),
  estimatedCostUsd: money.nullish(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  hasOutput: z.boolean(),
  hasError: z.boolean(),
  workflowName: z.string().nullish(),
  environment: z.string().nullish(),
  nodeTotal: z.number().int().nonnegative().nullish(),
  nodeCommitted: z.number().int().nonnegative(),
  /** Compact worker-maintained JSON: [{n,s,ms}]. */
  ribbonJson: z.string(),
  incidentId: uuid.nullish(),
});
export type RunSummary = z.infer<typeof runSummary>;

export const runDetail = runSummary.extend({
  outputJson: jsonObject.nullable(),
  errorJson: jsonObject.nullable(),
});
export type RunDetail = z.infer<typeof runDetail>;

export const runPage = page(runSummary);

/** `routes/RunRoutes.kt` — `RunEvent.toResponse()`. */
export const runEvent = z.object({
  id: uuid,
  runId: uuid,
  workspaceId: uuid,
  environmentId: uuid,
  sequence: z.number(),
  type: z.string(),
  status: z.string().nullable(),
  source: z.string().nullable(),
  timestamp: isoDateTime,
  durationMs: z.number().nullish(),
});
export type RunEvent = z.infer<typeof runEvent>;

/**
 * `GET /api/runs/:id/queue-position` (`routes/QueuePositionRoutes.kt`).
 *
 * A discriminated union on `queued`, because the two cases genuinely carry
 * different fields — a run that is no longer waiting has no position, no ETA
 * and no reason, and modelling that as "everything nullable" would let a screen
 * render "position null" instead of "already running".
 *
 * `reason` is the field that matters most: `tenant_cap` means the caller's own
 * concurrency limit is the cause and the remedy is theirs; `global_saturation`
 * means the platform is busy and it is not their fault. Rendering both as
 * "queued" turns a plan limit into an apparent outage.
 *
 * `etaSeconds` is null when recent throughput is too low to measure. That is an
 * honest "we do not know", and the UI must show position without an ETA rather
 * than invent one.
 */
export const queuePositionWaiting = z.object({
  runId: uuid,
  status: z.string(),
  queued: z.literal(true),
  position: z.number(),
  executionClass: z.string().nullable(),
  priority: z.number(),
  reason: z.enum(["tenant_cap", "global_saturation"]),
  etaSeconds: z.number().nullable(),
  throughputPerSecond: z.number(),
  message: z.string(),
});

export const queuePositionSettled = z.object({
  runId: uuid,
  status: z.string(),
  queued: z.literal(false),
  position: z.null(),
  message: z.string(),
});

export const queuePosition = z.discriminatedUnion("queued", [
  queuePositionWaiting,
  queuePositionSettled,
]);
export type QueuePosition = z.infer<typeof queuePosition>;

/**
 * The UI's run-status vocabulary, and the mapping onto it.
 *
 * One function rather than a lookup scattered through screens: the two
 * vocabularies genuinely differ, and the translation has to live somewhere
 * findable.
 */
export type UiRunStatus =
  | "succeeded"
  | "failed"
  | "running"
  | "queued"
  | "awaiting-approval"
  | "cancelled";

export function toUiRunStatus(status: RunStatus): UiRunStatus {
  switch (status) {
    case "completed":
    case "succeeded":
      return "succeeded";
    case "awaiting_approval":
    case "waiting_for_approval":
      return "awaiting-approval";
    case "timed_out":
    case "enqueue_failed":
      return "failed";
    case "paused":
    case "waiting_for_timer":
    case "recovering":
    case "yielded":
      return "queued";
    case "cancellation_requested":
    case "continued_as_new":
      return "cancelled";
    default:
      return status;
  }
}
