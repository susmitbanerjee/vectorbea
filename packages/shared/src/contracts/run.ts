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

export const runStatus = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "awaiting_approval",
  "paused",
  "timed_out",
]);
export type RunStatus = z.infer<typeof runStatus>;

export const triggerType = z.enum(["schedule", "webhook", "manual", "api"]);
export type TriggerType = z.infer<typeof triggerType>;

/**
 * A run as the LIST endpoint returns it.
 *
 * Note what is absent and what the UI expects:
 *   - no `workflowName`  — only `workflowId`; the Runs table shows a name
 *   - no `environment`   — only `environmentId` (a UUID); the UI filters by name
 *   - no `nodes[]`       — the run graph is detail-only
 *   - no ribbon fields   — `ribbon_json` exists in the DB (V027) but is not selected
 *
 * All four are catalogued in API-GAPS.md rather than papered over here.
 */
export const runSummary = z.object({
  id: uuid,
  workspaceId: uuid,
  environmentId: uuid,
  workflowId: uuid,
  workflowVersionId: uuid,
  status: runStatus,
  triggerType,
  currentStepId: z.string().nullable(),
  currentAgentId: uuid.nullable(),
  idempotencyKey: z.string().nullable(),
  startedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
  durationMs: z.number().nullable(),
  totalTokens: z.number().nullable(),
  estimatedCostUsd: money.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  hasOutput: z.boolean(),
  hasError: z.boolean(),
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
  durationMs: z.number().nullable(),
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
      return "succeeded";
    case "awaiting_approval":
      return "awaiting-approval";
    case "timed_out":
      return "failed";
    case "paused":
      return "queued";
    default:
      return status;
  }
}
