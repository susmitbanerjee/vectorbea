# Agent harness: code reconnaissance findings

Verification of the six open questions in
[AGENT-HARNESS-ARCHITECTURE.md](./AGENT-HARNESS-ARCHITECTURE.md) §16, plus a code
map for §18 and a list of places where the source contradicts the plan.

Scope: **read-only**. No runtime code was changed. Verified against `dev` at
`406369f`, 2026-08-29.

Line references are `path:line` at that commit.

---

## Verdicts

| # | Claim | Verdict |
|---|---|---|
| 1 | Tool guard key collision (`StepExecutionGuard` keyed on the synthetic id) | **REFUTED** — and the real collision is elsewhere |
| 2 | Approval resume is unreconciled | **CONFIRMED** — plus three more unreconciled parkings |
| 3 | `agent_iterations` has no unique key | **REFUTED** — the key exists and is already used for upsert |
| 4 | `GraphClassifier` needs only a type addition | **CONFIRMED** — for the classifier; the lane it feeds needs more |
| 5 | `RunEventStore` callers sanitize before calling | **PARTIAL** — 21 call sites, one real leak, one structural gap |
| 6 | Architect leaves `current_version_id` null | **CONFIRMED** — the workflow cannot be run until republished |

---

## 1. Tool guard key collision — REFUTED

### The claim

> The synthetic tool node id is `<stepId>:tool:<toolId>` … If `StepExecutionGuard`
> uses that same id, then an agent calling the same tool twice with *different
> arguments* in one step appears to have already completed and receives the first
> call's cached output.

### The synthetic id is real and is stable

`apps/worker-kotlin/.../agents/brain/runtime/AgentBrainRunner.kt:838-842`

```kotlin
val syntheticNode = WorkflowNode(
    id     = "${config.stepId}:tool:${toolId}",
    type   = "tool",
    config = mapOf("toolId" to toolId.toString()),
)
```

The comment above it (`AgentBrainRunner.kt:816-837`) documents why: the id is the
approval key, `findApproval(runId, nodeId)` is how a resumed run finds the
decision, and an iteration-numbered id opened a fresh gate on every resume.

### Why the collision cannot happen

**The synthetic node never reaches `StepExecutionGuard`.** Three independent
reasons, any one of which is sufficient:

1. **The guard is only invoked from `WorkflowRuntime`, on graph nodes.**
   `stepGuard.tryAcquire` has exactly one call site:
   `apps/worker-kotlin/.../runtime/WorkflowRuntime.kt:722-724`, inside
   `executeGuardedWithRetry` (`WorkflowRuntime.kt:705-751`). That method is
   reached from `executeNode` (`WorkflowRuntime.kt:672-681`), which is driven by
   `GraphScheduler` over the parsed graph. The brain calls the executor directly:
   `AgentBrainRunner.kt:848` — `executor.execute(syntheticNode, inputs, runtimeCtx)`.
   Nothing on that path consults a guard.

2. **The brain's `ToolNodeExecutor` is constructed without a guard.**
   `AgentBrainRunner.kt:117-121`:
   ```kotlin
   private val toolExecutor: ToolNodeExecutor? by lazy {
       val ds = dataSource ?: return@lazy null
       val pools = dbPoolManager ?: return@lazy null
       ToolNodeExecutor(ds, connectionResolver, pools, eventStore)
   }
   ```
   `ToolNodeExecutor`'s constructor (`ToolNodeExecutor.kt:39-44`) takes a
   `DataSource`, a `ConnectionResolver`, a pool manager and an event store. There
   is no `StepExecutionGuard` parameter on it, and no reference to the class
   anywhere in the file.

3. **There is no cached output to serve.** `StepExecutionGuard.AcquireResult`
   (`StepExecutionGuard.kt:30-34`) carries only `status` and `executionId` — the
   class KDoc's `guard.cachedResult` (`StepExecutionGuard.kt:21`) does not exist
   as a field. The cache is `StepOutputStore`, read separately at
   `WorkflowRuntime.kt:726` (`stepOutputStore.loadRaw(ctx.runId, node.id)`), and
   step outputs are persisted only by `WorkflowRuntime.persistStepOutput`
   (`WorkflowRuntime.kt:1594`) for graph nodes. No row is ever written under
   `<stepId>:tool:<toolId>`, so even a hypothetical `ALREADY_COMPLETED` would
   fall through the `cached == null` branch at `WorkflowRuntime.kt:736-738` and
   re-execute.

**The scenario, traced.** An `iterative_agent` step `n-agent-1` calls tool `T` at
iteration 2 with `{customerId: "A"}` and again at iteration 5 with
`{customerId: "B"}`. Both build node id `n-agent-1:tool:T`. Both land at
`ToolNodeExecutor.execute`, which does a fresh workspace-scoped tool lookup
(`ToolNodeExecutor.kt:80`), builds a fresh synthetic config from the *current*
`resolvedInputs` (`ToolNodeExecutor.kt:113`) and dispatches on `tool.type`
(`ToolNodeExecutor.kt:116-153`). The second call executes with `B`. There is no
cache lookup on the path.

### But the same id **does** collide — at three other layers

The doc named the wrong mechanism, not a non-existent problem.

**(a) The approval gate — a real, documented collision.**
`ToolNodeExecutor.approvalGate` (`ToolNodeExecutor.kt:192-241`) finds by
`(runId, node.id)` at `:198` and applies `decideOnApproval` at `:211`. Two calls
to the same gated tool in one step share one gate: the second inherits the first
decision. The KDoc says so at `ToolNodeExecutor.kt:184-190`, and
`AgentBrainRunner.kt:833-836` calls it "the bargain". It is real, and it is worse
than "one approval per (step, tool)" implies — the arguments are not part of the
key, so approving `DELETE FROM x WHERE id=1` also approves
`DELETE FROM x WHERE id=2` in the same step. §9's proposed
`<activationId>:tool:<toolId>` does **not** fix this; it changes the scope from
step to activation but still omits the arguments.

**(b) `model_calls` — a genuine key collision on a stable node id.**
`AgentBrainRunner.callLlm` builds its LLM node with `id = config.stepId`
(`AgentBrainRunner.kt:700-712`), i.e. the *agent step's own id*, once per
iteration. `ModelCallRecorder` writes with `ON CONFLICT (run_id, node_id,
attempt_number, call_index) DO NOTHING` (`replay/ModelCallRecorder.kt:248`) and
`LlmNodeExecutor` always passes `callIndex = 0`
(`runtime/executor/LlmNodeExecutor.kt:209`). `ReplayContext.nextModelCall`
increments a per-node cursor (`replay/ReplayContext.kt:123`) and throws
`NotReplayableException` on a miss (`ReplayContext.kt:159-161`). So for any
multi-iteration agent step, recording would keep only iteration 1 and replay
would fail at iteration 2.

**(c) …except that the agent path records and replays nothing at all.**
`AgentBrainRunner.kt:139` — `LlmNodeExecutor(connectionResolver, eventStore)` —
supplies neither `recorder` nor `replay`, and `AgentNodeExecutor`
(`runtime/executor/AgentNodeExecutor.kt:40-51`) has no parameter for either, so
`NodeExecutorRegistry` (`NodeExecutorRegistry.kt:61`) cannot forward what it
receives at `:36-38`. Consequences:
  - Agent steps write no `model_calls` rows, so (b) is currently latent.
  - **`REPLAY_RUN` over a workflow containing an agent node executes the agent
    live** — real LLM calls and real tool calls — because the brain's own
    executors have no `ReplayContext`.
  - The KDoc at `AgentBrainRunner.kt:137` claiming the agent gets "replay
    recording … for free" is false.

**(d) `SideEffectGuard` is absent from every tool path.**
`ToolNodeExecutor` builds its sub-executors at `ToolNodeExecutor.kt:53-56` —
`HttpNodeExecutor(connectionResolver, eventStore)` with no `sideEffects`. The
registry does the same for `NodeType.TOOL` (`NodeExecutorRegistry.kt:60`) while
passing the guard to `NodeType.HTTP` (`:56`). So an agent's HTTP tool call, and a
workflow's `tool` node HTTP call, both bypass the exactly-once guard; only a bare
`http` node gets it.

**(e) `DbWriteNodeExecutor`'s idempotency is a stub.**
`DbWriteNodeExecutor.kt:151-164` reads an `idempotencyKey` and calls
`checkIdempotency`, which is a no-op returning `null`
(`DbWriteNodeExecutor.kt:442-455`); `saveIdempotency` is an empty body
(`:457-465`). The KDoc at `:30-32` describes behaviour the code does not have.

**(f) `StepExecutionGuard`'s own `idempotencyKey` parameter is never supplied.**
The signature accepts one (`StepExecutionGuard.kt:44`) and the column exists with
an index (`V009__durable_execution.sql:120, 130-132`), but the sole call site
(`WorkflowRuntime.kt:723-724`) omits it, so `step_executions.idempotency_key` is
always NULL. §1's "extends to activations with a wider key" therefore starts from
an unused mechanism, not a working one.

---

## 2. Approval resume reliability — CONFIRMED

### The enqueue failure is logged and swallowed

`apps/api-kotlin/.../routes/ApprovalRoutes.kt:213-242`:

```kotlin
val q = queue
if (q != null && run != null) {
    runCatching {
        q.enqueue(WorkflowRunJob(... jobType = JobType.RESUME_RUN ...))
    }.onFailure { e ->
        log.error("[approval] failed to enqueue RESUME_RUN for runId={}: {}", approval.runId, e.message)
        // Don't fail the request — the decision is already recorded; operator can retry
    }
}

return Response.ok(mapOf(
    "id" to id.toString(), "decision" to decision,
    "message" to "Approval $decision. Run will resume shortly.",
))
```

The decision is durable (`repo.decide`, `:153-159`), the caller gets `200` with
the message "Run will resume shortly", and nothing will resume it.

**Worse than the doc states:** the enqueue is inside `if (q != null && run != null)`.
If `runRepo` is unwired or `findById` returns null, the enqueue is skipped with
**no log line at all** and the same `200` is returned. `queue` and `runRepo` are
both nullable constructor dependencies of the route.

### Crash recovery does not scan `waiting_for_approval`

`apps/worker-kotlin/.../durable/RunLeaseManager.kt:151`:

```sql
WHERE ar.status IN ('running', 'yielded')
```

`CrashRecoveryLoop.tick` (`durable/CrashRecoveryLoop.kt:55-67`) calls only
`leaseManager.findStaleRuns`. A run in `waiting_for_approval` is invisible to it.

### Every other place a run parks on an external event

There are exactly two parking statuses beyond `yielded`. Enumerating status
literals across both Kotlin modules yields: `queued`, `running`, `yielded`,
`recovering`, `waiting_for_timer`, `waiting_for_approval`, `scheduled`,
`succeeded`, `failed`, `cancelled`. `agent_runs.status` has no CHECK constraint
(`V001__initial_schema.sql:218`), so the set is defined by code alone.

| Parked state | Reconciler | Verdict |
|---|---|---|
| `yielded` (cooperative yield) | `runCatching { reEnqueue }` at `RunProcessor.kt:900-905`, backstopped by `findStaleRuns` | **Covered** — and the code says so at `:901-902` |
| `yielded` (provider throttle) | Timer at `RunProcessor.kt:942-955`, backstopped by `findStaleRuns` | **Covered** — `:928-932` |
| `waiting_for_timer` | `TimerScheduler.tick` → `findDueTimers` (`durable/TimerScheduler.kt:120-177`) | **Partially covered — see below** |
| `waiting_for_approval` | none | **Unreconciled** |
| `recovering` | none | **Unreconciled — new finding** |

**`recovering` is a second unreconciled park.** `CrashRecoveryLoop.recover`
sets `status='recovering'` (`CrashRecoveryLoop.kt:74`, `markRecovering` at
`:110-119`) and *then* enqueues (`:92-103`). The whole body is wrapped in
`catch (e: Exception)` at `:105-107`. If the enqueue throws, the run is left in
`recovering`, which `findStaleRuns` does not scan — so the recovery loop can
strand a run permanently while trying to rescue it.

**`waiting_for_timer` has the same shape.** `TimerScheduler.tick` calls
`markFired(timer.id)` (`TimerScheduler.kt:125`) *before* `enqueueJob`
(`:127-138`); the catch is at `:140-142`. `findDueTimers` requires
`t.status = 'scheduled'` (`:157`), so once marked `fired` the timer is never
retried and the run sits in `waiting_for_timer` forever. Redis being the enqueue
transport makes this a realistic failure, not a theoretical one.

**Not a parking source:** `webhook_wait` and `timer` node types map to
`NodeType.UNKNOWN` (`runtime/graph/WorkflowGraph.kt:593-594`), so no node parks a
run on an inbound external call today.

`RunProcessor.kt:544` already accepts all five as resumable
(`fromStatuses = listOf("waiting_for_approval", "recovering", "waiting_for_timer", "yielded", "queued")`),
so a reconciler needs no state-machine change — only a sweep and an enqueue.

---

## 3. `agent_iterations` uniqueness — REFUTED

### The unique key exists

`apps/api-kotlin/src/main/resources/db/migration/V010__agent_brain.sql:30-59`:

```sql
CREATE TABLE IF NOT EXISTS agent_iterations (
    id                            UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id                  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id                UUID NOT NULL,
    run_id                        UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    step_id                       TEXT NOT NULL,
    agent_id                      UUID NOT NULL,
    iteration_number              INTEGER NOT NULL,
    status                        TEXT NOT NULL DEFAULT 'running',
    thought_summary_sanitized     TEXT,
    action_type                   TEXT,
    selected_tool_id              UUID,
    tool_call_id                  UUID,
    llm_call_id                   UUID,
    observation_summary_sanitized TEXT,
    tokens_used                   INTEGER NOT NULL DEFAULT 0,
    estimated_cost_cents          NUMERIC NOT NULL DEFAULT 0,
    started_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at                  TIMESTAMPTZ,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_iterations_status_check
        CHECK (status IN ('running','completed','failed','skipped')),
    UNIQUE (run_id, step_id, iteration_number)
);
```

Indexes: `(run_id, step_id, iteration_number)` and `(workspace_id, run_id)`
(`V010:56-59`). `V010` is the only migration that touches the table — no later
migration alters it.

### The key is not merely present, it is load-bearing

`AgentBrainRunner.persistIterationStart` (`AgentBrainRunner.kt:942-975`) upserts
against it:

```sql
INSERT INTO agent_iterations (id,workspace_id,environment_id,run_id,step_id,agent_id,iteration_number,status)
VALUES(?,?,?,?,?,?,?,'running')
ON CONFLICT (run_id,step_id,iteration_number) DO UPDATE SET
  status='running', action_type=NULL, thought_summary_sanitized=NULL,
  observation_summary_sanitized=NULL, tokens_used=0, estimated_cost_cents=0,
  started_at=now(), completed_at=NULL
RETURNING id
```

So a replay from iteration 1 **overwrites** the previous attempt's rows in place.
It does not double them. §10 item 3's premise — "`agent_iterations` has no unique
key today, so writing them back doubles rows on every resume" — is the behaviour
of `agent_memory_entries`, not `agent_iterations`. That table genuinely has no
unique key (`V010:65-78` — no constraint on `(run_id, agent_id, key)`), which is
exactly what `AgentLoopState.addRecalledMemory`'s comment describes
(`agents/brain/model/AgentLoopState.kt:21-31`). The doc transplanted the memory
trap onto the iterations table.

The *right* key for §10 is still an open question: the existing key is
`(run_id, step_id, iteration_number)`, with no `attempt` component, so an
explicit `RETRY_NODE` re-run of an agent step silently overwrites the first
attempt's transcript. §10's proposed `UNIQUE (activation_id, attempt, iteration_index)`
is a **replacement** of an existing constraint plus a backfill, not an addition.

### What is actually persisted per iteration

Written by `persistIterationStart` (`:942-975`) and `persistIterationComplete`
(`:977-1002`), called from 12 sites (`AgentBrainRunner.kt:285, 308, 316, 336,
367, 428, 432, 470, 483, 495, 504, 533`):

| Column | Written? | Detail |
|---|---|---|
| `status` | yes | `running` → `completed` / `failed` |
| `action_type` | yes | `action.type.name` |
| `thought_summary_sanitized` | yes | `action.reasoningSummary`, **truncated to 500 chars** (`:992`) |
| `observation_summary_sanitized` | yes | **truncated to 500 chars** (`:993`) |
| `tokens_used`, `estimated_cost_cents` | yes | cumulative budget snapshot, not a per-iteration delta |
| `started_at`, `completed_at` | yes | |
| `selected_tool_id` | **never** | column exists, no writer |
| `tool_call_id` | **never** | column exists, no writer |
| `llm_call_id` | **never** | column exists, no writer |
| action arguments (`toolInput`) | **never** | no column exists |
| observation payload | **never** | no column exists |

**Only a sanitized summary is stored; the observation payload is not.** The
payload lives solely in memory: `AgentObservation.payload`
(`agents/brain/model/AgentLoopState.kt:70`), populated at `AgentBrainRunner.kt:852`
from `renderToolPayload`, held in `AgentLoopState.observations` (`:10`), rendered
into the next prompt, and discarded when the step returns.
`AgentIterationRoutes.kt:33-53` reads back exactly the columns above, so the
debugger cannot show a tool result today either.

`tokens_used` being cumulative rather than a delta matters for §10's "budget
delta" reconstruction: the delta must be derived by differencing consecutive rows.

---

## 4. `GraphClassifier` precedence — CONFIRMED (for the classifier)

`apps/api-kotlin/.../queue/GraphClassifier.kt:29`:

```kotlin
private val AGENT_NODE_TYPES = setOf("llm", "agent")
```

`classify` (`:48-90`) walks nodes once (`:67-71`), sets `hasAgentNode` on a set
membership test, and returns at `:75`:

```kotlin
if (hasAgentNode) return ExecutionClass.AGENT
```

That return precedes the node-count check (`:78`), the long-node check (`:80`) and
the fan-out check (`:85-87`). Adding `"agent_team"` to the set at `:29` is
sufficient and needs no change to the rule ordering. `nodeType` reads the
top-level `type` field (`:97-98`), which is where the builder writes it.

### Two caveats the plan should absorb

**The memo can be poisoned during a rolling deploy.**
`ExecutionClassResolver` (`queue/ExecutionClassResolver.kt:57-95`) is a permanent
two-tier memo: in-process map, then `workflow_versions.execution_class` written
at `:85`. If an API instance without the `agent_team` type classifies such a
graph first, it falls through to SHORT or LONG, persists that
(`V020__execution_class.sql:47-48`, nullable, no CHECK), and every later instance
reads the wrong class forever. The classifier change must ship *before* any
`agent_team` node can be saved, or the memo needs invalidating.

**§12.3's `runs.agent.child` lane is not a `TypedStreamsWorkflowQueue` change.**
Stream keys are derived from the enum and nowhere else:
- `queue/ExecutionClass.kt:26` — `val streamKey: String get() = "runs.$wire"`
- `queue/ExecutionClass.kt:29` — `val consumerGroup: String get() = "runs.$wire.workers"`
- worker `queue/TypedStreamConsumer.kt:95` — `fun streamKeyFor(type: WorkerJobType): String = "runs.${type.name.lowercase()}"`

`TypedStreamsWorkflowQueue.enqueue` (`:50-51`) just reads
`job.executionClass.streamKey`. A child lane therefore requires a new
`ExecutionClass` entry, a matching `WorkerJobType` (`worker/queue/WorkerJobType.kt:14-25`),
a pool in `ExecutionPoolRouter` (`:42`) and `ExecutionSlots` (`:85`), and a
consumer wired in `Main.kt` — and `WorkerJobType.name.lowercase()` cannot produce
a dotted `agent.child`, so either the naming scheme or that derivation has to
change. §18 lists only `TypedStreamsWorkflowQueue.kt` as changed; that file needs
no edit at all.

---

## 5. `RunEventStore` sanitization contract — PARTIAL

### The contract is stated and the store honours it

`apps/worker-kotlin/.../events/RunEventStore.kt:22-24`:

> SECURITY: `RunEvent.metadataJsonSanitized` and `RunEvent.errorJsonSanitized`
> must already be sanitized by the caller — this class stores them as-is.

Reiterated on the data class (`:40-45`) and per-field (`:64, :66`). `appendEvent`
(`:214-218`) → `insertEvent` (`:249`) → `doInsert` (`:282`) → `bindInsert`
(`:384`); no transformation of any caller-supplied string anywhere in the file.
The contract holds: a `SpanWriter` can adopt it unchanged.

Note the contract as written covers only the two JSON fields, while the data
class KDoc (`:43-45`) also names `title` and `summary`. Callers treat all four as
in scope; the span writer's contract should say so explicitly.

### Every current call site

21 call sites across 10 files. All executor sites funnel through a private
`emitEvent` helper that never sets the JSON fields except where noted.

| File:line | Sets metadata/error JSON | Compliance |
|---|---|---|
| `runtime/RunProcessor.kt:448` (RUN_STARTED) | no | **complies** — literal title |
| `runtime/RunProcessor.kt:552` (RUN_RESUMED) | no | **complies** — constructed from checkpoint sequence + `triggeredBy` |
| `runtime/RunProcessor.kt:648` (RETRY_NODE) | no | **complies** |
| `runtime/RunProcessor.kt:721` (REPLAY_STARTED) | no | **complies** — literal summary |
| `runtime/RunProcessor.kt:799` (SECURITY_CONTEXT_MISMATCH) | `errorJsonSanitized` at `:808` | **complies** — fixed literal, ids only |
| `runtime/RunProcessor.kt:851` (RUN_SUCCEEDED) | no | **complies** |
| `runtime/RunProcessor.kt:906` (RUN_REENQUEUED) | no | **complies** — `execResult.reason` is a runtime-generated label |
| `runtime/RunProcessor.kt:957` (RUN_YIELDED) | no | **complies** |
| `runtime/RunProcessor.kt:988`, `:1021` | no | **complies** |
| `runtime/RunProcessor.kt:1239` (RUN_FAILED) | `errorJsonSanitized` at `:1243` | **complies** — every caller passes a literal or `sanitizeError(e)` (`:1411-1417`: 300-char cap, base64-ish tokens and `://user:pass@` redacted) |
| `runtime/RunProcessor.kt:1293` (incident) | no | **complies** — incident id only |
| `runtime/WorkflowRuntime.kt:1576` (all runtime events) | `meta` and `error` params (`:1586-1587`) | **gap — see below** |
| `durable/CrashRecoveryLoop.kt:80` (RUN_RECOVERY_STARTED) | no | **complies** |
| `agents/brain/runtime/AgentBrainRunner.kt:1059` (22 `emitEvent` calls) | no | **complies** — `summary.take(300)` at `:1068`; reasoning passes `AgentSafetyGuard.sanitizeReasoningSummary` first (`:325`) |
| `runtime/executor/AgentNodeExecutor.kt:537` | no | **complies** |
| `runtime/executor/ToolNodeExecutor.kt:644` | no | **complies** — summaries are `type=…`, tool name, duration |
| `runtime/executor/HttpNodeExecutor.kt:461` | no | **complies** — one raw-ish summary at `:184` (`e.message?.take(200)` from the SSRF guard, an internally-generated message) |
| `runtime/executor/DbReadNodeExecutor.kt:314` | no | **complies** — `rowCount`, `durationMs` |
| `runtime/executor/DbWriteNodeExecutor.kt:478` | no | **complies** — `affectedRows`, `paramCount`, `provider` |
| `runtime/executor/LlmNodeExecutor.kt:907` | `metadataJsonSanitized = meta` (`:916`) | **complies** — `meta` carries groundedness counts only; summaries at `:293`/`:303` are internally generated |

### The one real gap

`runtime/WorkflowRuntime.kt:1315-1319`:

```kotlin
emitEvent(ctx, EventType.STEP_FAILED, "running", source,
    title   = "Failed: ${nodeLabel(node)}",
    summary = retryNote,
    stepId  = node.id,
    error   = """{"reason":${jsonStr(result.reason)},"nodeType":"${node.type}"}""")
```

`jsonStr` (`WorkflowRuntime.kt:1912-1913`) is a JSON string escaper — backslash,
quote, newline — **not a sanitizer and not a truncator**. `result.reason` is
whatever the executor put in `NodeResult.Failed`, written verbatim into a column
named `error_json_sanitized`. Most producers are disciplined:

- `DbWriteNodeExecutor.kt:269-271` uses `describeDbError` (`:91-103`), which
  splits off the `DETAIL:` section — where Postgres echoes row values — and caps
  at 300.
- `HttpNodeExecutor.kt:299` caps at 200 and never includes the response body.
- `LlmCallException` messages are all code-constructed (`LlmNodeExecutor.kt:685,
  692, 707, 735, 769`) and carry a status code, never a provider body.

But the boundary is by convention at each producer, not enforced at the writer,
and `LlmNodeExecutor.kt:314` (`"LLM call failed for node '${node.id}': ${e.message}"`)
is uncapped. `WorkflowRuntime.kt:1118` has the same shape for mapping failures.
The column name asserts a property nothing checks.

**For the plan:** `SpanWriter` and `PayloadStore` can adopt the contract, but §16
item 5's implied conclusion — "callers sanitize, so the span writer needs no
sanitizer" — is true only for the two JSON fields as *used today*, and only
because most producers happen to be careful. Span payloads will carry prompts and
tool results, which are exactly the values no producer currently caps.

### Structural gap: observability is not non-blocking

Invariant 7 says span and event writes "use bounded buffers and drop to a counter
under pressure", and §12.1 specifies a 250 ms / 50-span flush. `RunEventStore`
today is fully synchronous: a per-run `ReentrantLock` (`:252-253`), a
`SELECT 1 … FOR UPDATE` on `agent_runs` (`:365-370`), `SELECT MAX(sequence)+1`
(`:372-382`), then the insert — on the calling thread, with a retry loop
(`:255-260`). There is no buffer and nothing to drop. The invariant describes the
target, not the code.

Two aggravating details for §12.2:
- `nextSequence` (`:374`) is `SELECT COALESCE(MAX(sequence),0)+1 FROM run_events WHERE run_id = ?`
  with **no `created_at` predicate**, against a table that `V028` partitions
  monthly. Every event write probes every partition.
- The API writes the same way against the same row lock
  (`api/repository/RunEventRepository.kt:86-98`), so the contention §12.2
  describes is already cross-process, not merely cross-thread.

---

## 6. Architect `setCurrentVersion` gap — CONFIRMED

`apps/api-kotlin/.../architect/WorkflowArchitectService.kt:672-688`:

```kotlin
val workflow = workflowRepo.create(CreateWorkflowRequest(... status = "draft"))

val version = workflowRepo.createVersion(CreateWorkflowVersionRequest(
    workflowId    = workflow.id,
    graph         = mapper.readValue(graphJson, Map::class.java) as Map<String, Any>,
    triggerConfig = mapOf<String, Any>("type" to (...)),
))

repo.saveWorkflowIds(session.id, workflow.id, version.id)
```

No `setCurrentVersion` call anywhere in the file. Confirming the two halves:

- `WorkflowRepository.create` (`repository/WorkflowRepository.kt:181-197`) inserts
  `workflows` without `current_version_id`; the column is nullable
  (`V001__initial_schema.sql:169`).
- `WorkflowRepository.createVersion` (`:282-307`) inserts `workflow_versions` and
  returns; it does not touch `workflows`.
- `setCurrentVersion` (`:221-225`) has exactly one caller in the codebase:
  `routes/WorkflowRoutes.kt:257`, inside `createVersion`, the handler for
  `POST /api/workflows/:id/versions`.
- `createWorkflow` itself has one caller:
  `architect/WorkflowArchitectRoutes.kt:292`.

So an Architect-built workflow leaves `workflows.current_version_id` NULL.

### The consequence is that the workflow cannot be run

`routes/RunRoutes.kt:264-265`:

```kotlin
val versionId = workflow.currentVersionId
    ?: throw ApiError.ValidationError("Workflow '${workflow.name}' has no current version — publish a version first")
```

`DurableRunRoutes.latestVersionId` (`:292-303`) reads the same column and returns
null. The user must open the workflow in the builder and save, which POSTs a
*second* version through `WorkflowRoutes.createVersion` and sets the pointer —
leaving version 1 orphaned. Nothing in `apps/web` reads or sets
`current_version_id`, so there is no client-side workaround in place.

`ContractRoutes.kt:297` inner-joins on `w.current_version_id`, so Architect
workflows are also silently absent from contract listings until republished.

The one-line fix is a `setCurrentVersion` call after
`WorkflowArchitectService.kt:686`, in the same try block, before
`repo.saveWorkflowIds`.

---

## Code map

### §18 worker paths, `apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/`

| Doc path | Status in doc | Exists? | Class / object | Signatures the plan must modify |
|---|---|---|---|---|
| `runtime/executor/AgentTeamNodeExecutor.kt` | new | no | — | must implement `NodeExecutor` (`runtime/executor/NodeExecutor.kt:16-39`): `suspend fun execute(node: WorkflowNode, resolvedInputs: Map<String, Any>, ctx: RuntimeContext): NodeResult` |
| `agents/orchestration/OrchestrationLoop.kt` | new | no | — | package `agents/orchestration/` does not exist |
| `agents/orchestration/AgentHarness.kt` | new | no | — | same |
| `runtime/executor/AgentCallExecutor.kt` | new | no | — | must implement `NodeExecutor` if registered; §5.3 implies it is called from the brain the way `ToolNodeExecutor` is at `AgentBrainRunner.kt:848` |
| `agents/orchestration/ActivationStore.kt` | new | no | — | |
| `agents/orchestration/HandoffStore.kt` | new | no | — | |
| `agents/budget/BudgetLedger.kt` | new | no | — | package `agents/budget/` does not exist; the existing flat budget is `agents/brain/model/AgentBudget.kt` + `agents/brain/runtime/AgentBudgetGuard.kt` |
| `agents/context/RunContextStore.kt` | new | no | — | package `agents/context/` does not exist |
| `agents/context/ContextAssembler.kt` | new | no | — | today's assembly is `agents/brain/prompts/AgentPromptBuilder.kt` |
| `events/SpanWriter.kt` | new | no | — | |
| `events/PayloadStore.kt` | new | no | — | |
| `agents/brain/runtime/AgentBrainRunner.kt` | changed | **yes** | `class AgentBrainRunner` (`:32-54`) | `suspend fun run(config: AgentBrainConfig, runtimeCtx: RuntimeContext): RunResult` (`:214`); `data class RunResult` (`:141`); `private suspend fun executeTool(action, config, runtimeCtx, state): ToolOutcome` (`:795`); `private suspend fun callLlm(config, systemPrompt, userPrompt, runtimeCtx): LlmCallResult` (`:700`); `private fun parseAction(rawContent, state, iterationId, config): AgentAction` (`:763`); `private fun persistIterationStart(config, state): UUID` (`:942`); `private fun persistIterationComplete(iterationId, status, action, observationSummary, budget)` (`:977`); `private fun resolveApprovalGate(config, reason): ApprovalGate` (`:627`); `internal fun failureSignature(summary: String): String` (`:97`) |
| `agents/brain/prompts/AgentPromptBuilder.kt` | changed | **yes** | `object AgentPromptBuilder` (`:14`) | `fun buildSystemPrompt(config: AgentBrainConfig, availableTools: List<ToolDescriptor>): String` (`:17`); `fun buildUserPrompt(config: AgentBrainConfig, state: AgentLoopState): String` (`:62`); `data class ToolDescriptor(id, name, description, inputSchema)` (`:97`) |
| `runtime/executor/AgentNodeExecutor.kt` | changed | **yes** | `class AgentNodeExecutor(dataSource, connectionResolver, eventStore, dbPoolManager)` (`:40-51`) | `override suspend fun execute(node, resolvedInputs, ctx): NodeResult` (`:82`); `internal fun shouldUseToolLoop(agentType: String, hasGrantedTools: Boolean, brainEnabled: Boolean?): Boolean` (`:72-77`); `private suspend fun executeIterativeAgent(agent: AgentRow, node, resolvedInputs, ctx): NodeResult` (`:407`); `private fun loadAgent(agentId: UUID, workspaceId: UUID): AgentRow?` (`:306`); `private fun innerBudgetMs(nodeTimeoutMs: Long): Long` (`:273`) |
| `events/RunEventStore.kt` | changed | **yes** | `open class RunEventStore(dataSource, pubSub)` (`:28`) | `open fun appendEvent(event: RunEvent): Int` (`:214`); `open fun forgetRun(runId: UUID)` (`:224`); `private fun insertEvent(event): Int` (`:249`); `private fun nextSequence(conn, runId): Int` (`:372`); `private fun lockRun(conn, runId)` (`:365`); `data class RunEvent` (`:46-68`); `enum class EventType` (`:70-204`) |
| `test/agents/ScriptedLlmProvider.kt` | new | **path is wrong** | — | the test source set is `apps/worker-kotlin/src/test/kotlin/com/vectorbea/worker/…`, not `src/main/kotlin/com/vectorbea/worker/test/`. It already exists, with 37 test files |

### §18 API paths, `apps/api-kotlin/src/main/kotlin/com/vectorbea/api/`

| Doc path | Status in doc | Exists? | Class / object | Signatures |
|---|---|---|---|---|
| `routes/TraceRoutes.kt` | new | no | — | sibling routes take a `Router` and register handlers; cf. `routes/ApprovalRoutes.kt:82` `fun register(router: Router)` |
| `queue/GraphClassifier.kt` | changed | **yes** | `object GraphClassifier` (`:24`) | `fun classify(graphJson: String?, longNodeThreshold: Int = DEFAULT_LONG_NODE_THRESHOLD, maxParallelBranches: Int = DEFAULT_MAX_PARALLEL_BRANCHES): ExecutionClass` (`:48-52`); `private val AGENT_NODE_TYPES` (`:29`) — **this is the whole edit**; `private fun nodeType(node: JsonNode): String` (`:97`) |
| `queue/TypedStreamsWorkflowQueue.kt` | changed | **yes, but needs no edit** | `class TypedStreamsWorkflowQueue(redis, legacyStreamKey, maxPayloadBytes) : WorkflowQueue` (`:37-46`) | `override fun enqueue(job: WorkflowRunJob): String` (`:50`) — reads `job.executionClass.streamKey` at `:51`; `private fun buildFields(job): Map<String, String>` (`:92`); `fun verifyStreams(redis, legacyStreamKey)` (`:112`). The lane change belongs in `queue/ExecutionClass.kt:11-43` and the worker's `queue/WorkerJobType.kt:14-25` |
| `schedule/ResumeReconciler.kt` | new | no | — | package `api/schedule/` exists (`CronExpression.kt`, `ScheduleRepository.kt`, `WorkflowScheduler.kt`) — a plausible home. See the amendment on which side it belongs |

### Paths the plan will need that §18 does not list

| Path | Why |
|---|---|
| `worker/runtime/graph/WorkflowGraph.kt:564-581` | `enum class NodeType` — `agent_team` needs an entry and a `fromString` case (`:598`) |
| `worker/runtime/executor/NodeExecutorRegistry.kt:43-62` | the `NodeType → NodeExecutor` map; `AgentTeamNodeExecutor` is unreachable without an entry |
| `worker/runtime/WorkflowRuntime.kt:168-171` | `GUARDED_NODE_TYPES` — an unguarded `agent_team` node re-executes on every resume |
| `api/queue/ExecutionClass.kt:11-43` | the child / interactive lanes (§12.3) |
| `worker/queue/WorkerJobType.kt:14-25`, `queue/ExecutionPoolRouter.kt:42`, `queue/ExecutionSlots.kt:85`, `queue/TypedStreamConsumer.kt:95` | the consuming half of a new lane |
| `worker/runtime/executor/AgentNodeExecutor.kt:40-51` | needs `recorder` / `replay` parameters before any record-replay suite (§12.6) can cover agents |
| `api/architect/WorkflowArchitectService.kt:686` | the §16 item 6 fix |

---

## Where the code contradicts the architecture doc

Ordered by how much of the plan each one moves.

1. **§12.6 / limit #7: "neither Kotlin module has a test source set."**
   False. `apps/worker-kotlin/src/test/kotlin/` has **37** test files, including
   `runtime/executor/AgentNodeExecutorRoutingTest.kt`,
   `agents/brain/runtime/AgentFailureSignatureTest.kt`,
   `runtime/WorkflowRuntimeResumeTest.kt` and
   `durable/SideEffectGuardIntegrationTest.kt`.
   `apps/api-kotlin/src/test/kotlin/` has **24**. JUnit 5, kotlinx-coroutines-test
   and BlockHound are wired in `apps/worker-kotlin/build.gradle.kts:75-83`.
   `ScriptedLlmProvider` is still the right idea; "create a test source set" is not
   a prerequisite, and §18's `test/agents/ScriptedLlmProvider.kt` path is wrong.

2. **§12.6: "`REPLAY_RUN` and recorded provider calls already exist" — not for agents.**
   `AgentNodeExecutor` (`:40-51`) accepts no `ModelCallRecorder` or
   `ReplayContext`, and `AgentBrainRunner.kt:139` builds its `LlmNodeExecutor`
   without them. Agent steps record nothing and replay live. A golden-run replay
   suite over orchestration cannot be built on today's recording.

3. **§10: the doubling premise is wrong; the overwrite premise is the real one.**
   `agent_iterations` has `UNIQUE (run_id, step_id, iteration_number)`
   (`V010:53`) and `persistIterationStart` upserts against it
   (`AgentBrainRunner.kt:951-959`). Resume overwrites, it does not double. The key
   also has no `attempt` column, so `RETRY_NODE` destroys the previous attempt's
   transcript — a different bug than the one described, and one §10's
   reconstruction depends on fixing.

4. **§1 "What carries over as-is": `StepExecutionGuard` idempotency does not reach the agent path.**
   The guard is invoked once, from `WorkflowRuntime.kt:723`, on graph nodes only.
   Neither the brain's tool calls nor its LLM calls are guarded, and the guard's
   `idempotencyKey` parameter (`StepExecutionGuard.kt:44`) is never supplied by
   its only caller. "Extends to activations with a wider key" extends an unused
   mechanism.

5. **§1 "Crash recovery, dead letters — unchanged."** Crash recovery has two holes
   today (`recovering`, and `waiting_for_timer` after `markFired`; §2 above) that
   multi-agent will widen, not merely inherit.

6. **Invariant 7 / §12.1: observability already blocks execution.**
   `RunEventStore` is synchronous with a per-run lock and a row-level
   `FOR UPDATE`, with no buffer and nothing to drop (`:249-282`, `:365-382`).
   §12.1's "batch writes, bounded queue, drop to a counter" is unimplemented for
   events, so a span writer that copies today's event writer would violate the
   invariant it is supposed to uphold.

7. **§12.2 understates the sequence problem.** `nextSequence`
   (`RunEventStore.kt:372-382`) has no partition-key predicate against the
   `V028`-partitioned `run_events`, so it probes every monthly partition on every
   event write. And the API writes through the identical pattern
   (`RunEventRepository.kt:86-98`), so batching in the worker alone does not
   remove the contention.

8. **§9's "activation-scoped tool gate" does not fix the argument problem.**
   The gate key is `(runId, nodeId)` (`ToolNodeExecutor.kt:198`) and arguments are
   nowhere in it. Rescoping from step to activation still lets one approval cover
   two different argument sets within one activation.

9. **§16 item 1's proposed fix targets a guard that is not in the path.**
   "Guard on `<stepId>:tool:<toolId>:<argsHash>`, approve on
   `<stepId>:tool:<toolId>`" cannot be implemented as a `StepExecutionGuard`
   change, because that guard never sees the synthetic node. The `argsHash` idea
   is still right — it belongs on the approval key, or on a new guard invoked from
   the brain.

10. **§12.3's `runs.agent.child` cannot be spelled with the current derivation.**
    `TypedStreamConsumer.streamKeyFor` is `"runs.${type.name.lowercase()}"`
    (`:95`), which cannot produce a dotted suffix from a Kotlin enum name.

11. **Two guards the doc treats as present are stubs or absent.**
    `DbWriteNodeExecutor.checkIdempotency` / `saveIdempotency` are no-ops
    (`:442-465`) despite the class KDoc at `:30-32`; `SideEffectGuard` is not
    wired into `ToolNodeExecutor`'s sub-executors (`:53-56`) or into the registry's
    `NodeType.TOOL` entry (`NodeExecutorRegistry.kt:60`).

12. **§4.1's new run statuses need no migration** — `agent_runs.status` is plain
    TEXT with no CHECK (`V001:218`), and `RunProcessor.kt:544` already treats
    `waiting_for_approval`, `recovering`, `waiting_for_timer`, `yielded` and
    `queued` as resumable. Cheaper than the doc implies.

### What the code confirms

For balance — these load-bearing claims verified clean:

- **Invariant 1 holds.** The grant check is runtime code:
  `safetyGuard.validateToolAllowed(action, config)` at `AgentBrainRunner.kt:302`,
  before any dispatch, throwing `ToolNotAllowedException` handled at `:312-321`
  with `retryable = false`.
- **Invariant 3 holds.** `TypedStreamConsumer.processAndAck` (`:282-293`) runs
  `processor.process(job)` to completion before `ackMessage(msgId)`.
- **Invariant 8 holds** for tools and agents:
  `ToolNodeExecutor.loadTool(toolId, ctx.workspaceId)` (`:80`),
  `AgentNodeExecutor.loadAgent(agentId, workspaceId)` (`:306`),
  `loadAllowedToolDescriptors` filtering on `workspace_id` (`AgentBrainRunner.kt:1012`).
- **The approval-key stability fix is real and correct**, and its rationale is
  recorded in the source (`AgentBrainRunner.kt:816-837`).
- **`shouldUseToolLoop` is already extracted and tested**
  (`AgentNodeExecutor.kt:72-77`, `AgentNodeExecutorRoutingTest.kt`), so §3's
  "stays exactly as it is" is safe.

---

## Addendum — dated production risk in `run_events` partitioning (2026-08-30)

**10. `run_events` partitions run out on 2026-11-01, and inserts will fail.**

Found while building the trace write path. Not a trace problem — an existing one.

[V028](apps/api-kotlin/src/main/resources/db/migration/V028__run_events_partitioning.sql)
shipped `run_events_ensure_partition()` and `run_events_drop_expired_partitions()`
and **nothing has ever called them** — no scheduler, no pg_cron, no pg_partman
anywhere in the stack (verified: zero Kotlin callers). The migration created the
current month plus two at deploy time and stopped:

```
ATTACH run_events_historical FOR VALUES FROM (MINVALUE) TO (2026-09-01)
ensure_partition(now + 1 month)   -- run_events_2026_09
ensure_partition(now + 2 months)  -- run_events_2026_10
```

V028 was committed **2026-08-17** (`4b59e3f`), so coverage ends **2026-10-31**.
`run_events` has **no DEFAULT partition**, so an insert past that boundary does not
degrade — it raises *"no partition of relation run_events found for row"* and every
event write in the system stops.

**Two possible production states, and which one you are in matters:**

| If V028's swap… | Then | Risk |
|---|---|---|
| **succeeded** (≤ ~5M rows at deploy) | `run_events` is partitioned, coverage ends 2026-10-31 | **Insert failures from 2026-11-01** |
| **declined** (> 5M rows — it warns and returns) | `run_events` is still a plain table | No cliff, but partitioning never happened |

I cannot tell which from here — `.env` points at localhost and the working copy has
no production credentials. Run this to find out:

```sql
SELECT relkind FROM pg_class WHERE relname = 'run_events';   -- 'p' = partitioned
SELECT c.relname FROM pg_class c
  JOIN pg_inherits i ON i.inhrelid = c.oid
  JOIN pg_class p ON p.oid = i.inhparent
 WHERE p.relname = 'run_events' ORDER BY 1;
```

`PartitionMaintenance` (V041 work) now calls the ensure functions hourly for both
tables and closes this, provided a worker is deployed before November. It checks
`relkind = 'p'` first, so it is a no-op rather than an error if the swap declined.
Dropping expired partitions is **off** unless `PARTITION_DROP_ENABLED=true`; until
then it only logs what it would drop.

---

## Addendum — found while building loop reconstruction (2026-08-29)

Three more, all verified the same way as the six above.

**7. `RuntimeContext.attemptGroup` is permanently 0.** No caller anywhere passes a
non-zero value (`grep -rn "attemptGroup" apps/worker-kotlin/src/main`). Its KDoc
says it increments on user-initiated re-runs and calls itself "the third component
of every side-effect idempotency key". It is inert. The visible consequence is not
the dormant `SideEffectGuard` key — it is that a **`RETRY_NODE` on an agent step
replays from iteration 1 and is served the previous attempt's cached tool results**,
because those synthetic tool nodes completed and their `step_executions` rows say
`succeeded`. Somebody clicking retry is not getting a retry. Filed as a standalone
fix ahead of P6, which introduces its own `attempt` on `agent_activations`.

**8. Three documented tick-budget knobs do nothing at any value.**
`ExecutionBudgetTracker.recordAgentIteration()`, `recordToolCall()` and
`recordLlmCall()` have **zero call sites**, so `MAX_AGENT_ITERATIONS_PER_TICK`,
`MAX_TOOL_CALLS_PER_TICK` and `MAX_LLM_CALLS_PER_TICK` gate counters that are always
zero. They are also unreachable by construction: `canContinue()` is consulted only
in the DAG scheduling loop, between nodes
([WorkflowRuntime.kt:458, 515, 541](apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/WorkflowRuntime.kt:458)),
so an agent step that has started cannot be interrupted mid-loop — there is no
moment for a per-tick iteration ceiling to fire. Wiring the recorders alone would
make the config *look* functional while staying inert. Marked not-implemented in
AGENT-BRAIN-EXECUTION §3; mid-loop yielding deferred to P9.

**9. `agent_iterations` numbering is contiguous, so a gap check is a valid refusal
condition.** Confirmed before relying on it: `status = 'skipped'` is in the V010
CHECK constraint and is **never written** (only `completed` and `failed` are), and
the loop persists a row for every iteration before doing anything with it
(`state.iteration++` at :420, `persistIterationStart` at :438). The budget check
between them can `break`, so the *last* number may exceed the last persisted row —
a trailing gap, never an interior hole. An interior hole therefore means a row was
lost, which is exactly what reconstruction should refuse on.

---

## Amendments required to the plan

| Doc section | Change | Why |
|---|---|---|
| **§16 item 1** | Rewrite. Record that `StepExecutionGuard` is not in the agent tool path (`WorkflowRuntime.kt:723` is its only caller; `AgentBrainRunner.kt:117-121` builds an unguarded `ToolNodeExecutor`). Retarget the `argsHash` fix at the **approval** key in `ToolNodeExecutor.approvalGate` (`:192-241`). | The stated failure mode cannot occur, and the fix as written has no code to apply to. |
| **§9 (Approvals table)** | Add arguments to the gate key: `<activationId>:tool:<toolId>:<argsHash>`. Note that this reopens the resume-stability question the current key was chosen to solve, so the hash must be over canonicalised arguments only — no iteration number, no timestamp. | Rescoping step→activation leaves the "approve `id=1`, get `id=2` free" hole open. Standing rule #2 applies. |
| **§10 (Durable loop state)** | Replace the premise. `agent_iterations` has `UNIQUE (run_id, step_id, iteration_number)` (`V010:53`) and already upserts against it. State the real problems instead: (a) the key lacks `attempt`, so `RETRY_NODE` overwrites the prior transcript; (b) `selected_tool_id`, `tool_call_id`, `llm_call_id` are declared but never written; (c) action arguments and the observation payload have no columns at all; (d) `tokens_used` is cumulative, so budget deltas must be differenced. Adding `UNIQUE (activation_id, attempt, iteration_index)` is a constraint **replacement** plus a backfill. | The migration is a different, larger piece of work than "add a unique key", and forward-only Flyway makes getting it right the first time non-optional. |
| **§16 item 3** | Mark REFUTED and point at `agent_memory_entries` (`V010:65-78`) as the table that genuinely lacks the key — which is what `AgentLoopState.addRecalledMemory`'s comment describes. | The doubling trap is real, just on a different table. |
| **§16 item 2 / §11 / §18** | Broaden the reconciler to three statuses, not one: `waiting_for_approval`, `recovering` (stranded by `CrashRecoveryLoop.kt:74` plus a throwing enqueue) and `waiting_for_timer` (stranded by `markFired` preceding `enqueueJob`, `TimerScheduler.kt:125-138`). Decide whether it lives in `api/schedule/` or beside `CrashRecoveryLoop` in the worker — the worker already owns `findStaleRuns`, `TimerScheduler` and the enqueue path, and adding the three statuses to `RunLeaseManager.findStaleRuns` (`:151`) plus a "resolved gate" predicate is a smaller change than a new API service. | A reconciler that covers only approvals leaves two identical bugs live. |
| **§12.3 and §18 (`TypedStreamsWorkflowQueue.kt` row)** | Remove that row; it needs no edit (`enqueue` reads `job.executionClass.streamKey` at `:51`). Replace with `api/queue/ExecutionClass.kt`, `worker/queue/WorkerJobType.kt`, `ExecutionPoolRouter.kt`, `ExecutionSlots.kt`, `TypedStreamConsumer.kt` and `Main.kt`. Note that `streamKeyFor` (`:95`) derives the key from the enum name and cannot produce `runs.agent.child` unchanged. | The lane change is six files and a naming decision, not one file. |
| **§12.3 / §16 item 4 (`GraphClassifier`)** | Keep CONFIRMED, add the ordering constraint: the `AGENT_NODE_TYPES` change must ship **before** any `agent_team` node can be saved, because `ExecutionClassResolver` writes a permanent per-version memo (`:85`) that an older instance would poison. | Rolling deploys are the norm here — the API and worker deploy independently, per the standing rules. |
| **§18 (worker table)** | Add `runtime/graph/WorkflowGraph.kt` (NodeType + `fromString`), `runtime/executor/NodeExecutorRegistry.kt` (the type→executor map) and `runtime/WorkflowRuntime.kt` (`GUARDED_NODE_TYPES`) as **changed**. Without all three an `agent_team` node resolves to `UNKNOWN`, routes to `UnsupportedNodeExecutor`, and would re-execute unguarded on resume. | The node type cannot be reached otherwise. |
| **§18 (`test/agents/ScriptedLlmProvider.kt`)** | Correct the path to `apps/worker-kotlin/src/test/kotlin/com/vectorbea/worker/agents/ScriptedLlmProvider.kt`. | `src/main/kotlin/.../worker/test/` would ship the stub in the production jar. |
| **§12.6 and §1 (limit #7)** | Delete "no test source set". Both modules have one (37 + 24 files, JUnit 5 + BlockHound). Replace the record-replay bullet: it cannot cover agents until `AgentNodeExecutor` and `AgentBrainRunner` accept `ModelCallRecorder` / `ReplayContext`. Add that as an explicit prerequisite alongside `ScriptedLlmProvider`. | The stated blocker does not exist; a different, unstated one does. |
| **New subsection under §12.6 or §9** | Record that `REPLAY_RUN` over a workflow containing an agent node **executes the agent live** — real provider calls, real tool side effects — because the brain's `LlmNodeExecutor` and `ToolNodeExecutor` have no `ReplayContext` (`AgentBrainRunner.kt:117-121, :139`). | A live correctness and cost problem independent of multi-agent, in the same class as §16 item 1's "should be fixed regardless". |
| **§12.1 / Invariant 7** | Say plainly that the non-blocking property does not exist yet for events. Sequence the work: `SpanWriter` must be built buffered from day one, and `RunEventStore` batching (§12.2 step 1) becomes a prerequisite rather than an optimisation. | Copying today's synchronous writer into `SpanWriter` would violate invariant 7 at 50–200× the volume. |
| **§12.2** | Add that `nextSequence` (`RunEventStore.kt:374`) has no partition predicate against the `V028`-partitioned `run_events`, and that `RunEventRepository.append` (`:86-98`) duplicates the pattern in the API. Moving the counter off the run row must cover both writers or the contention remains. | Batching one writer while the other holds the same row lock buys little. |
| **§16 item 5** | Downgrade to PARTIAL. The contract holds at the store, but it is unenforced at the producers: `WorkflowRuntime.kt:1319` writes `result.reason` into `error_json_sanitized` through `jsonStr`, which escapes rather than sanitizes, and `LlmNodeExecutor.kt:314` is uncapped. Require `SpanWriter` / `PayloadStore` to cap and redact at the write boundary for payload-bearing fields. | Standing invariant 4 says sanitization happens once, at the write boundary — that is true for events by convention only, and prompts and tool results are exactly what no producer caps today. |
| **§16 item 6 / §14** | Keep CONFIRMED and raise the severity: the workflow is not merely missing a pointer, it **cannot be run** (`RunRoutes.kt:264-265`) and is absent from contract listings (`ContractRoutes.kt:297`). One line after `WorkflowArchitectService.kt:686`. Fix before Phase 3, not "before teams become generatable". | It is a live product bug on the Architect path today. |
| **§1 ("What carries over as-is")** | Amend two rows. `StepExecutionGuard` idempotency does not currently reach agent tool or LLM calls. Crash recovery is not "unchanged" — it has two strand-the-run holes. | Both are listed as assets that transfer for free; neither does. |
| **§4.1 / §17** | Note that `agent_runs.status` has no CHECK constraint (`V001:218`) and `RunProcessor.kt:544` already accepts the five resumable statuses, so new run-level statuses cost no migration. Activation statuses are a new table and unaffected. | Removes a phantom migration from the Phase 3 plan. |
