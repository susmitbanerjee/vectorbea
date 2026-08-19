# Replay audit

Answering §2 of `07-AGENT-RELIABILITY.md` against the code as it stands before
this change. Every claim below is quoted from the tree.

**Verdict, stated once and plainly: the product does not have replay.** The button
labelled "Replay" starts a brand-new execution that calls every provider again,
costs tokens again, and re-fires every side effect. On a workflow that sends email,
pressing Replay sends the email a second time.

---

## Q1. What does the current "Replay" action actually do?

`POST /api/runs/:id/replay` → `RunRoutes.replayRun`
([RunRoutes.kt:762](apps/api-kotlin/src/main/kotlin/com/vectorbea/api/routes/RunRoutes.kt:762)).

Its own KDoc is accurate about what it does — it is the *name* that is wrong:

```kotlin
/**
 * Replay a completed or failed run from the beginning.
 *
 * Creates a new run row (new ID) with the same workflow version, workspace,
 * and input JSON. Enqueues a START_RUN job for the new run.
 */
```

The trace:

1. Load the original run, validate the workflow still exists.
2. **Create a new run row with a new id**, same `workflow_version_id`, same
   `input_json`, `triggerType = "replay"`.
3. Enqueue a job:

```kotlin
val job = WorkflowRunJob(
    runId             = newRun.id.toString(),
    …
    jobType           = JobType.START_RUN,
    inputJson         = original.inputJson,
)
```

`JobType.START_RUN` is the same job type a fresh manual trigger produces. From the
worker's perspective nothing distinguishes this from a first execution — it loads
the graph, walks it from the trigger node, and executes every node for real.

**This is a re-run.** It is the third operation in §2's table, mislabelled as the
first. `JobType.REPLAY_RUN` exists in the enum
([WorkflowQueue.kt:66](apps/api-kotlin/src/main/kotlin/com/vectorbea/api/queue/WorkflowQueue.kt:66))
and is referenced in comments, but the replay endpoint does not use it — it is
used by `retryRun`, which is a different confusion again.

---

## Q2. Are model responses persisted in full, or only the parsed result?

**Only the parsed result, and only three fields of it.**

The provider's response is parsed into a three-field struct and the raw body is
dropped on the floor
([LlmNodeExecutor.kt:554](apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/executor/LlmNodeExecutor.kt:554)):

```kotlin
private data class LlmResponse(
    val content: String?,
    val finishReason: String? = null,
    val tokenCount: Int? = null,
)
```

What reaches the event history:

```kotlin
emitEvent(context, node.id, EventType.LLM_CALL_COMPLETED, "success",
    title = "LLM call completed",
    summary = "provider=$provider model=$model durationMs=$durationMs" + …,
    durationMs = durationMs,
    modelName = model,
    tokenCount = result.tokenCount,
    estimatedCost = estimatedCostUsd)
```

`summary` is a human-readable string. `model_name` is the **alias** the user
configured (`gpt-4o`), not the resolved version the provider actually served
(`gpt-4o-2024-08-06`). Measured against §2's required set:

| Required field | Persisted? |
|---|---|
| provider | Only inside the prose `summary` string |
| model_id | `model_name` — the alias |
| **model_version (resolved)** | **No** |
| temperature, top_p, max_tokens | **No** |
| **seed** | **No** — and never sent |
| response_format | **No** |
| prompt_hash | **No** |
| **full_request_body** | **No** |
| **full_response_body** | **No** |
| logprobs | **No** — never requested |
| finish_reason | **No** — parsed, then discarded |
| tokens_in / tokens_out | Only the **total**, `token_count` |
| latency_ms | Yes, `duration_ms` |
| cost | Yes, `estimated_cost` |
| attempt_number | Column `retry_attempt` exists; the LLM executor never sets it |

`step_outputs` holds the node's *output* (`raw/extracted/validated`), so the
content string survives. That is enough to show a user what a node produced. It is
not enough to reconstruct the call, verify it, or diff two attempts — and it is
categorically not an audit substrate.

---

## Q3. Does replay re-call the provider?

**Yes. This is the bug.**

There is no interception anywhere on the path. `replayRun` → `START_RUN` →
`WorkflowRuntime.execute` → `LlmNodeExecutor.execute` → `callProvider` →
`OutboundHttp.send`. Nothing in that chain consults the original run's history,
and nothing can: the new run has a different id and the history is keyed by run id.

The executor's own comment describes a real network call, because that is what it
makes:

```kotlin
val result = try {
    WorkerMetrics.timeBlocking {
        OutboundHttp.send(reqBuilder, totalCallMs = timeoutMs, …)
    }
```

So a "replay" costs full token price, takes full latency, and — the point §2
makes — returns a **different answer**. The engineer who opened the replay to
investigate a bad decision sees a different decision.

---

## Q4. Does replay re-execute tool calls and side effects?

**Yes, and this is worse than Q3.**

Vectorbea has an exactly-once side-effect guard, added in the durability work. It
is correct, and it does not help here. The idempotency key
([SideEffectGuard.kt:67](apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/durable/SideEffectGuard.kt:67)):

```kotlin
fun keyFor(runId: UUID, nodeId: String, attemptGroup: Int): String {
    val material = "$runId|$nodeId|$attemptGroup"
    …
}
```

The key is derived from **`runId`**. A replay is a new run with a new id, so the
key is different, so the guard has never seen it, so it returns `Proceed` and the
call is made.

That is the correct behaviour for the guard — a genuine re-run *should* send the
email again — but it means the safety net that stops duplicate side effects on
retry provides exactly zero protection on "replay". Pressing a button labelled
"Replay" on a run that posted to Slack posts to Slack again.

This is the finding I would escalate first. It is a customer-visible incident
waiting on a mislabelled button.

---

## Q5. Is the event history sufficient to reconstruct a run without any external call?

**No.** Three independent gaps, any one of which is disqualifying.

**1. Model calls cannot be reproduced.** Per Q2, neither request nor response body
is stored. The content string in `step_outputs` is the *parsed* output; a node
that read `finish_reason`, inspected `logprobs`, or depended on any other part of
the response cannot be reconstructed at all.

**2. Tool and HTTP responses are not stored as responses.** `side_effects.response`
holds a result for the exactly-once path, but only for guarded side-effecting
nodes, and it is keyed for deduplication rather than for reconstruction.

**3. Non-determinism is uncaptured.** 22 direct calls to `Instant.now()`,
`UUID.randomUUID()` and friends in `worker/runtime/` alone:

```
$ grep -rn "Instant.now()\|UUID.randomUUID()\|Math.random\|Random(" \
    --include=*.kt apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/ | wc -l
22
```

Every one is a value that would differ on a second execution and is not recorded
anywhere a replay could read it. A workflow whose output embeds a timestamp or a
generated id cannot be byte-identical across two executions even if every model
call were perfectly reproduced.

---

## What the UI currently promises

`RecoveryTab.tsx` offers exactly one control — "Resume from checkpoint" — gated on
`replaySafeResumeAvailable`, and `StepDetailsPanel.tsx` renders a per-step "Replay
safe: Yes/No" field. The word "replay" appears in the interface attached to a
guarantee the backend does not provide.

---

## Summary of defects

| # | Defect | Severity |
|---|---|---|
| R1 | "Replay" enqueues `START_RUN` — it is a re-run under the wrong name | **Critical** |
| R2 | Replay re-fires side effects, because the idempotency key is derived from `run_id` | **Critical** |
| R3 | Model request/response bodies are never persisted | **Critical** — blocks any real replay |
| R4 | Model version, params, seed, finish_reason, logprobs, tokens_in/out unrecorded | High |
| R5 | Non-deterministic values (time, uuid, random) unrecorded | High |
| R6 | One operation exposed where three are needed | High |
| R7 | UI advertises "replay safe" against a guarantee that does not exist | High |

R1 and R2 together mean the honest description of the current button is: *"re-run
this workflow, charge me again, and re-send anything it sent."*


---

# Part 2 - what was built, and what it now does

The audit above describes the code before this change. Everything below is after.

## The three operations

| Operation | Endpoint | Calls providers | Side effects | Cost | New run id |
|---|---|---|---|---|---|
| **Replay** | `POST /api/runs/:id/replay` | **Never** | **Never** | **Zero** | Yes (marked `replay`) |
| **Retry** | `POST /api/runs/:id/retry` | Yes, from the checkpoint | Yes, for remaining nodes | Partial | No - same run |
| **Re-run** | `POST /api/runs/:id/rerun` | Yes, all | Yes, all | Full | Yes (marked `rerun`) |

`/rerun` is the behaviour `/replay` used to have, under its honest name. Nothing
was removed; one thing was renamed and a genuinely new operation took its place.

Partial replay: `POST /api/runs/:id/replay {"untilNode": "n1"}` - recorded up to
and including `n1`, live after it.

## The acceptance test

`scripts/load/replay-acceptance.mjs`, run against a live worker and API:

```
> original run 52e526f2...
  status=succeeded nodes=10 providerCalls=8 cost=1c tokens=960
  model_calls recorded: 8
> replay run 7966c67b...
  status=succeeded nodes=10 providerCalls=0 cost=0c tokens=0

  PASS  byte-identical output at every node - 10 nodes, 0 diverged
  PASS  zero provider calls during replay - 0 calls
  PASS  zero side effects during replay - 0 side effects
  PASS  zero cost - 0c / 0 tokens
  PASS  replay reached the same terminal status - succeeded vs succeeded
```

Provider calls are counted at the **mock upstream**, not in our own metrics: the
question is whether a packet left the worker, and only the far end can answer that
honestly.

## Partial replay and the hard-fail rule

`scripts/load/replay-partial.mjs`:

```
> original 2f153ba9...: 8 provider calls
  nodes with recorded calls: n1, n2, n3, n4, n5, n6, n7, n8
> partial replay until 'n1' -> 202
  status=succeeded providerCalls=7
> replay of an unrecorded run -> 422 UNPROCESSABLE_ENTITY
> rerun -> 202 status=succeeded providerCalls=8

  PASS  partial replay accepted
  PASS  partial replay makes SOME calls but fewer than the original - 7 vs 8
  PASS  partial replay completes - succeeded
  PASS  unrecorded run refused, not executed live - 422
  PASS  rerun calls providers for real - 8 vs 8
```

7 of 8, exactly as specified: `n1` came from the recording, `n2`-`n8` ran live.

## The rule that makes replay meaningful

**Any attempt to make an external call during replay is a hard error.** Not a
fallthrough, not a warning - `ReplayContext.NotReplayableException`, naming the
node.

A replay that quietly falls through to the provider when it cannot find a
recording is worse than no replay at all: it looks like it worked, it costs money
the user was told it would not cost, it returns a different answer while claiming
to be faithful, and it hides an incomplete recording behind a green tick.

Enforced in two places, deliberately:

1. `LlmNodeExecutor` serves the recorded response *before* resolving the connection
   secret - so a replay works even after the connection is deleted or the key
   rotated, which is exactly when an incident replay is most needed.
2. `doHttpPost` refuses any outbound call when a replay is active and the executor
   has not explicitly authorised a live call past a partial-replay boundary.

The API also refuses up front: replaying a run with zero recorded calls returns
`422` explaining why and naming Re-run as the alternative, rather than accepting
the job and failing deep in a worker.

## One bug found by the partial-replay test

The first implementation of the HTTP backstop refused *every* outbound call
whenever a replay context was present. Correct for a full replay; wrong for the
live half of a partial one, which failed with zero provider calls.

The boundary decision is now made once by the executor, where the node id is
known, and carried to the HTTP layer on the capture object. The HTTP layer has no
idea which node it is serving and should not have to guess.

## What is recorded now

Every provider call writes a `model_calls` row with: provider, model id, **resolved
model version** (read from the response, not the configured alias), temperature,
top_p, seed, max_tokens, response_format, prompt hash, full request body, full
response body, logprobs, finish_reason, tokens_in, tokens_out, latency, cost,
attempt number and call index. Bodies over 256KB offload with the key stored
inline.

Failed and throttled calls are recorded too, with `outcome != 'ok'`. Replay
reproduces the failure rather than skipping it - skipping would let the replayed
run take a different branch from the original.

**Redaction:** credentials are stripped from the stored request by walking the
parsed structure. The prompt and the response are never redacted. They are the
audit substrate, and a redacted audit trail cannot answer the question it exists
for.

## The UI

`components/runs/RunOperations.tsx` replaces the single button. Three controls,
each stating what it calls, what it costs, and whether side effects fire - on the
control, not in a tooltip. Only the operations that spend money ask for
confirmation: confirming a free read-only action trains people to click through
confirmations, which is how the expensive one gets clicked through too.

Replay is disabled with an explanation when the run has no recording, and shows
the recorded call count when it does - "reconstructed from 8 recorded calls" is
why it is free, where a bare "free" invites doubt.

## Still open

- **`recorded_values` is created but not yet written to.** The determinism journal
  for clock/uuid/random exists as schema and as a read path in `ReplayContext`, but
  no executor journals to it. The acceptance test passes byte-identically because
  the agent fixture does not embed a timestamp in its output; a workflow that
  stamped `now()` into its output would still diverge. Recorded as **D20**, and it
  is the remaining gap between "replay works" and "replay always works".
- **Tool and HTTP node responses are not yet served from a recording.** Only model
  calls are. Such a workflow now hits the `doHttpPost` backstop and fails loudly
  rather than silently re-firing - the safe direction, but not the finished one.
  Recorded as **D21**.
- The `SideEffectGuard` key is still derived from `run_id`, so a **re-run** re-fires
  side effects. That is correct for re-run. Replay never reaches the guard because
  it never executes a side-effecting call.
