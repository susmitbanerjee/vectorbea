import type { LogLevel } from "~/lib/runs/model";

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT A RUN'S LOG SAYS TO THE PERSON WHO OWNS THE RUN

   ── WHAT IT USED TO SAY ───────────────────────────────────────────────────
   The log pane rendered each event as the raw row:

       NODE_SUCCEEDED status=succeeded source=worker:wrk-7f3a9c21-e4b8 412ms
       RUN_LEASE_RENEWED status=running source=worker:wrk-7f3a9c21-e4b8 3ms

   Three separate problems, and only the first is cosmetic:

     · `source` is the WORKER IDENTITY. `worker:wrk-7f3a9c21-e4b8` is our fleet,
       our naming and our scaling decisions, shown to somebody who bought a
       workflow engine. It is also the field most likely to change shape when we
       change how we deploy, which makes it a support liability as well.
     · The type is an internal enum, in an internal vocabulary. `STEP_INPUT_
       RESOLVED` is a statement about our execution model; a customer's
       question is "did my step run".
     · `RUN_LEASE_RENEWED`, `WORKER_CLAIMED`, `RUN_REENQUEUED` are the mechanics
       of durable execution — the thing the product does so the customer does
       not have to think about it. Putting them in the default view spends the
       reader's attention on the part that is working.

   ── WHAT IT SAYS NOW, AND WHAT IS KEPT ────────────────────────────────────
   This is a TRANSLATION, not a deletion. Nothing is dropped from the event
   stream, the API response is unchanged, and the pane's Raw toggle shows the
   stored row verbatim for support. What changes is the default view:

     · `source` never renders. It is on the API response for support and in the
       Debug tab; it is not an answer to any question a customer has.
     · the type becomes a sentence, from [describe].
     · durable-execution plumbing is classified `debug` by [levelFor], so the
       default floor of `info` hides it and one click brings it back.

   ── THE FALLBACK IS THE IMPORTANT PART ────────────────────────────────────
   There are 113 event types and more arrive with every phase. A hand-written
   map of all of them is a map that is wrong the first time somebody adds one,
   and the failure mode of a missing entry must not be "leak the enum". So the
   map below covers the types worth a real sentence, and everything else falls
   through [humanise], which turns any `FOO_BAR_BAZ` into "Foo bar baz" — from
   the type alone, so a new event can never carry a worker id, a thread name or
   a class name into this pane by default.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * The events that are durable-execution MECHANICS rather than work.
 *
 * Leases, claims, re-enqueues and recovery are how the platform survives a
 * worker dying. They are real, they are worth recording, and they are not what
 * the person watching their invoice run is looking for — so they are `debug`
 * and sit under the default floor.
 *
 * Matched on the whole type rather than a prefix: `RUN_WAIT_STARTED` and
 * `RUN_LEASE_RENEWED` share a prefix and are opposite in kind — one is the run
 * waiting for a person, which is the single most important thing the log can
 * say, and the other is a heartbeat.
 */
const PLUMBING: ReadonlySet<string> = new Set([
  "RUN_LEASE_ACQUIRED",
  "RUN_LEASE_RENEWED",
  "RUN_LEASE_EXPIRED",
  "RUN_REENQUEUED",
  "RUN_YIELDED",
  "RUN_RESUMED",
  "RUN_RECOVERY_STARTED",
  "RUN_RECOVERY_COMPLETED",
  "WORKER_CLAIMED",
  "CHECKPOINT_CREATED",
  "STEP_SCHEDULED",
  "STEP_INPUT_RESOLVED",
  "STEP_INPUT_VALIDATED",
  "STEP_OUTPUT_VALIDATED",
  "CONNECTION_RESOLVED",
  "INPUT_MAPPING_STARTED",
  "INPUT_MAPPING_COMPLETED",
  "OUTPUT_EXTRACTION_STARTED",
  "OUTPUT_EXTRACTION_COMPLETED",
  "HTTP_REQUEST_PREPARED",
  "DB_QUERY_PREPARED",
  "DB_WRITE_PREPARED",
  "TRACE_EXPORT_CROSS_WORKSPACE",
  "AGENT_LOOP_RECONSTRUCTED",
  "AGENT_LOOP_RECONSTRUCTION_SKIPPED",
  "AGENT_MEMORY_UPDATED",
  "CONTINUE_AS_NEW_RECOMMENDED",
  "CONTINUE_AS_NEW_REQUESTED",
]);

/**
 * The sentence for the types where "Foo bar baz" is not good enough.
 *
 * Present tense for things in flight, past tense for things that finished —
 * the copy rule that keeps a scanned log readable without reading the level.
 * No internal nouns: no lease, no checkpoint, no CAS, no activation.
 */
const PHRASES: Readonly<Record<string, string>> = {
  RUN_STARTED: "Run started",
  RUN_SUCCEEDED: "Run finished",
  RUN_FAILED: "Run failed",
  RUN_CANCELLED: "Run cancelled",
  RUN_CANCELLED_CLEANLY: "Run cancelled",
  RUN_CANCELLATION_REQUESTED: "Cancellation requested",
  RUN_CONTINUED_AS_NEW: "Run continued in a new run",

  /* The three that matter most, because they are the ones where the run is
     fine and nothing is happening — the state a reader is most likely to
     misread as stuck. */
  RUN_WAIT_STARTED: "Waiting",
  RUN_WAIT_RESOLVED: "Finished waiting",
  RUN_WAIT_TIMED_OUT: "Gave up waiting",

  NODE_STARTED: "Step started",
  NODE_SUCCEEDED: "Step finished",
  NODE_FAILED: "Step failed",
  NODE_SKIPPED: "Step skipped",
  NODE_TYPE_UNSUPPORTED: "Step type is not supported",
  STEP_STARTED: "Step started",
  STEP_COMPLETED: "Step finished",
  STEP_FAILED: "Step failed",
  STEP_SKIPPED: "Step skipped",
  STEP_SCHEMA_VALIDATION_FAILED: "Step output did not match its schema",

  TOOL_CALL_STARTED: "Calling tool",
  TOOL_CALL_COMPLETED: "Tool returned",
  TOOL_CALL_FAILED: "Tool call failed",

  LLM_CALL_STARTED: "Calling model",
  LLM_CALL_COMPLETED: "Model replied",

  HTTP_REQUEST_STARTED: "Sending request",
  HTTP_REQUEST_COMPLETED: "Request returned",

  DB_QUERY_STARTED: "Running query",
  DB_QUERY_COMPLETED: "Query returned",
  DB_WRITE_COMPLETED: "Write finished",

  APPROVAL_REQUESTED: "Waiting for approval",
  APPROVAL_APPROVED: "Approved",
  APPROVAL_REJECTED: "Rejected",

  SIGNAL_RECEIVED: "Signal received",
  SIGNAL_DELIVERED: "Signal delivered",
  TIMER_SCHEDULED: "Timer set",
  TIMER_FIRED: "Timer fired",
  TIMER_CANCELLED: "Timer cancelled",

  RETRY_REQUESTED: "Retry requested",
  RETRY_STARTED: "Retrying",

  DELIVERY_QUEUED: "Result queued for delivery",
  DELIVERY_ATTEMPTED: "Delivering result",
  DELIVERY_SUCCEEDED: "Result delivered",
  DELIVERY_FAILED: "Delivery failed",
  DELIVERY_DEAD: "Delivery gave up",

  AGENT_STARTED: "Agent started",
  AGENT_COMPLETED: "Agent finished",
  AGENT_FAILED: "Agent failed",
  AGENT_CANCELLED: "Agent cancelled",
  AGENT_ITERATION_STARTED: "Agent thinking",
  AGENT_ACTION_SELECTED: "Agent chose an action",
  AGENT_TOOL_SELECTED: "Agent chose a tool",
  AGENT_TOOL_NOT_ALLOWED: "Agent asked for a tool it was not granted",
  AGENT_INVALID_ACTION: "Agent returned something unusable",
  AGENT_MAX_ITERATIONS_REACHED: "Agent ran out of steps",
  AGENT_BUDGET_EXCEEDED: "Agent ran out of budget",
  AGENT_CONTEXT_BUDGET_EXCEEDED: "Agent's context did not fit",
  AGENT_OUTPUT_SCHEMA_INVALID: "Agent output did not match its schema",
  AGENT_OUTPUT_VALIDATED: "Agent output checked",
  AGENT_FINAL_OUTPUT_CREATED: "Agent produced its answer",
  AGENT_APPROVAL_REQUESTED: "Agent asked for approval",
  AGENT_GUIDANCE_RECEIVED: "Guidance received",

  /* Capacity. Named for what the customer experiences — a wait — rather than
     for the mechanism that produced it. */
  POOL_SATURATED: "Waiting for capacity",
  TENANT_THROTTLED: "Waiting for capacity",
  HISTORY_LIMIT_WARNING: "This run is getting long",

  SECRET_MISSING: "A credential is missing",
  CONNECTION_VALIDATION_FAILED: "A connection could not be used",
  FAILURE_INCIDENT_CREATED: "Failure grouped into an incident",
};

/** `FOO_BAR_BAZ` → `Foo bar baz`. The safety net; see the header. */
function humanise(type: string): string {
  const words = type.toLowerCase().split("_").filter(Boolean);
  if (words.length === 0) return "Event";
  return words.join(" ").replace(/^./, (c) => c.toUpperCase());
}

/** What this event says, in the customer's vocabulary. Never includes a source. */
export function describe(type: string): string {
  return PHRASES[type] ?? humanise(type);
}

/**
 * True when this event is durable-execution mechanics.
 *
 * Exported so the pane can label the `debug` filter honestly rather than
 * leaving a reader to wonder what turning it on would show them.
 */
export function isPlumbing(type: string): boolean {
  return PLUMBING.has(type);
}

/**
 * The level, which is what decides whether a line is in the default view.
 *
 * Failure beats plumbing: a `TOOL_CALL_FAILED` is an error even though the
 * retry that follows it is mechanics. Checking the status first is what keeps
 * a failure from being classified into invisibility.
 */
export function levelFor(type: string, status?: string | null): LogLevel {
  const t = type.toUpperCase();
  const s = (status ?? "").toLowerCase();

  if (s === "failed" || t.includes("FAILED") || t.includes("TIMED_OUT") || t === "SECRET_MISSING") {
    return "error";
  }
  if (
    t.includes("NOT_ALLOWED") || t.includes("INVALID") || t.includes("EXCEEDED") ||
    t === "POOL_SATURATED" || t === "TENANT_THROTTLED" || t === "HISTORY_LIMIT_WARNING" ||
    t === "RUN_LEASE_EXPIRED" || t === "DELIVERY_DEAD"
  ) {
    return "warn";
  }
  if (isPlumbing(t)) return "debug";
  return "info";
}
