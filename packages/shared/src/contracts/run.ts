import { z } from "zod";
import { isoDateTime, jsonEncoded, jsonValue, maybe, money, page, uuid } from "./primitives";

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
 * A NOTE ON `maybe()` AND `.nullish()` BELOW
 * ------------------------------------------
 * Nullable columns are wrapped in `maybe()` rather than marked `.nullable()`.
 * That is not defensive padding — it is what the API actually does.
 *
 * Every response is assembled as a Kotlin `mapOf(...)`, and the response mapper
 * is configured `JsonInclude.Include.NON_NULL`, so it drops null entries rather
 * than emitting `"field": null`. An absent value therefore arrives as a MISSING
 * KEY, and `z.string().nullable()` rejects a missing key with "Required" — the
 * whole response fails validation and the transport raises `contract_mismatch`.
 *
 * That is why live data reached no screen: five of the eight endpoints the
 * Control page needs were failing validation before a component ever saw them.
 * Fixing those by hand left the same latent bug in forty-eight other fields,
 * one of which (`workflow.currentVersionId`) broke the workflows list the first
 * time anybody created a workflow. `maybe()` is that fix applied once, in
 * `primitives.ts`, so the next nullable column cannot reintroduce it.
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
  /*
   * Parked on something that is not a person and not a clock: an async tool
   * still working, or a signal that has not arrived. Distinct from
   * `waiting_for_approval` because nobody is being asked to do anything, and
   * distinct from `queued` because the run HAS started — it is holding no
   * worker while it waits. See docs/WAITS-AND-SIGNALS.md.
   */
  "waiting_for_event",
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

/**
 * How a run was started.
 *
 * Mirrors `TriggerSource` in the API. `event` and `mcp` joined the four
 * originals when ingress grew those doors — and this enum is not decorative:
 * a run whose `triggerType` is missing here fails response validation, so the
 * Runs page would break for exactly the runs a new integration produces.
 */
export const triggerType = z.enum([
  "schedule", "webhook", "manual", "api", "event", "mcp",
]);
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

/**
 * A run plus the two payload columns the list endpoint leaves out.
 *
 * Both go through `jsonEncoded` because the API has shipped them BOTH ways: as
 * JSON once `RunRoutes.toDetailResponse()` learned to decode the column, and as
 * a string of JSON before that. Web and API deploy separately, so the browser is
 * routinely a deploy ahead of or behind the API and has to read either.
 *
 * `jsonValue`, not `jsonObject`: these carry whatever the run produced. A
 * workflow whose final node returns a list stores a JSON array, and demanding an
 * object there fails the response for a run that did nothing wrong.
 */
export const runDetail = runSummary.extend({
  outputJson: maybe(jsonEncoded(jsonValue)),
  errorJson: maybe(jsonEncoded(jsonValue)),
});
export type RunDetail = z.infer<typeof runDetail>;

export const runPage = page(runSummary);

/**
 * `GET /api/runs/:id/waits` (`routes/SignalRoutes.kt`, reading the
 * `run_active_waits` view).
 *
 * WHAT A RUN IS PARKED ON, which is the question a parked run raises and
 * nothing else on the page answers. A run holding no worker for six minutes
 * looks identical to a hung one; this is the difference between the two.
 *
 * ACTIVE WAITS ONLY. A resolved wait is history, and history is the event log —
 * `RUN_WAIT_STARTED` / `RUN_WAIT_RESOLVED` bracket it there with real
 * timestamps. Serving resolved waits here too would give the timeline two
 * sources for the same span that could disagree.
 *
 * `expiresInMs` is null when the wait has no deadline, and goes NEGATIVE once
 * the deadline has passed but the sweeper has not yet run — which is a real
 * state worth showing rather than clamping, because "overdue" is exactly when
 * somebody is looking.
 */
export const runWait = z.object({
  waitId: uuid,
  /** `approval` | `async_tool` | `signal` | `agent_wait` — the wire names of `WaitKind`. */
  kind: z.string(),
  /** Written for a person: "waiting for render_video to finish". */
  label: maybe(z.string()),
  nodeId: maybe(z.string()),
  /** Set for signal waits: the signal name that will resolve this. */
  signalName: maybe(z.string()),
  /** The provider's handle for the work, when the tool returned one. */
  externalRef: maybe(z.string()),
  createdAt: isoDateTime,
  timeoutAt: maybe(isoDateTime),
  waitingMs: z.number(),
  expiresInMs: z.number().nullish(),
  pollAttempts: z.number(),
});
export type RunWait = z.infer<typeof runWait>;
export const runWaitPage = page(runWait);

/** `routes/RunRoutes.kt` — `RunEvent.toResponse()`. */
export const runEvent = z.object({
  id: uuid,
  runId: uuid,
  workspaceId: uuid,
  environmentId: uuid,
  sequence: z.number(),
  type: z.string(),
  status: maybe(z.string()),
  source: maybe(z.string()),
  timestamp: isoDateTime,
  durationMs: z.number().nullish(),
});
export type RunEvent = z.infer<typeof runEvent>;
/** `GET /api/runs/:id/events` returns the standard Page envelope. */
export const runEventPage = page(runEvent);

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
  executionClass: maybe(z.string()),
  priority: z.number(),
  reason: z.enum(["tenant_cap", "global_saturation"]),
  etaSeconds: maybe(z.number()),
  throughputPerSecond: z.number(),
  message: z.string(),
});

export const queuePositionSettled = z.object({
  runId: uuid,
  status: z.string(),
  queued: z.literal(false),
  /**
   * Always null — a run that is no longer waiting has no position.
   *
   * `maybe()` rather than `z.null()` because the route writes
   * `"position" to null` and the NON_NULL mapper then drops the key, so the
   * literal-null form matched a payload the API cannot produce. `queued` is
   * what discriminates the union; this field only has to survive being absent.
   */
  position: maybe(z.null()),
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
  | "waiting"
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
    /*
     * Parked, not pending. `queued` says the platform has not started this run;
     * for a six-minute render, a timer, or a cooperative yield that is false and
     * reads to an operator as a backed-up queue. `awaiting-approval` is equally
     * wrong — it says a person must act. `waiting` says the true thing: the run
     * is fine, it is holding nothing, and it will resume on its own.
     */
    case "waiting_for_event":
    case "waiting_for_timer":
    case "yielded":
      return "waiting";
    case "paused":
    case "recovering":
      return "queued";
    case "cancellation_requested":
    case "continued_as_new":
      return "cancelled";
    default:
      return status;
  }
}
