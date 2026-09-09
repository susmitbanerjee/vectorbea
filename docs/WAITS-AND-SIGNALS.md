# Waits and signals

How a run parks on something outside itself and resumes when it arrives.

Companion to `docs/AGENT-HARNESS-ARCHITECTURE.md` (the runtime the wait suspends)
and `docs/HTTP-TOOLS.md` (the async tool protocol that is this primitive's
largest customer).

---

## 1. Two requirements, one shape

Two things were unbuildable, and it took a while to see they were the same
thing.

**Async tools.** A video generation tool takes six minutes. Under a strict
request-response tool model the only choices are to hold a worker for six
minutes or to fail. That excludes a whole category: media generation, long
report builds, batch jobs, human tasks in another system.

**Signals.** An incident automation run is active and a second alert arrives for
the same service. There was no way to deliver new information into a running
run. Runs took input at start and never again.

Both are *a run waits for an external event and resumes*, which is exactly what
the approval gate already did. Building two more parking mechanisms would have
been three implementations of durable suspension, three reconciler sweeps, three
sets of timeout semantics and three ways for a run to get stuck — against
invariant 9, one engine.

So the approval gate was generalised rather than copied. There is one wait
primitive, and approval is now one of its kinds.

---

## 2. The primitive

A **wait** is a durable row saying: this run is parked, this is what will
un-park it, and this is when to give up.

```
run_waits
  wait_key        derived, unique per (run_id, node, attempt group)
  kind            approval | async_tool | signal | agent_wait
  status          waiting | resolved | timed_out | cancelled
  label           written for a person
  signal_name     for signal and agent_wait
  callback_token  for async_tool, when a callback secret is configured
  external_ref    the provider's handle for the work
  timeout_at      the deadline; never null in practice, see §6
  resolution      completed | failed | timeout | cancelled | signal
```

`WaitKind` carries the run status each kind parks in:

| Kind | `agent_runs.status` | Opened by | Live? |
|---|---|---|---|
| `approval` | `waiting_for_approval` | the approval gate | **not yet — see §12** |
| `async_tool` | `waiting_for_event` | an HTTP tool whose spec declares `async` | yes |
| `signal` | `waiting_for_event` | a node waiting for a named signal | yes |
| `agent_wait` | `waiting_for_event` | the model choosing the `WAIT` action | behind a flag |

Approval keeps its own status because it is the one kind a *person* is expected
to act on, and the screens that route work to people key off it. The rest share
`waiting_for_event`: to the scheduler they are identical, and giving each its
own status would have multiplied the resume CAS by four for no behavioural
difference.

`approval` is defined, parks in a status the resume CAS accepts, and is swept by
the reconciler — everything downstream of an approval wait works today. What does
not yet happen is the approval gate WRITING one; it still parks through the
`approvals` table and `ExecutionResult.WaitingForApproval`. §12 says why that last
step is a question rather than a commit.

### 2.1 The key is derived, never generated

```kotlin
RunWait.keyFor(runId, nodeId, attemptGroup)   // SHA-256 → "vbw_" + 40 hex
```

Same derivation as `SideEffectGuard.keyFor`, for the same reason (invariant 2).
A step re-executes **from iteration 1** on resume. A key containing an iteration
number, a timestamp or a random id would differ between attempts, and the run
would open a second wait for work that is already in flight — parking forever
behind a callback that resolves the first one.

Because the key is derived, re-execution finds the existing wait instead of
opening a new one. That is what makes resume idempotent, and it is why nothing
in this feature may be keyed on anything a retry does not reproduce.

### 2.2 Callback tokens are derived too

```kotlin
RunWait.callbackTokenFor(waitKey, secret)     // HMAC-SHA256 → "cb_" + 48 hex
```

The token has to be two contradictory things: **unguessable**, because
`POST /api/tool-callbacks/:token` is an unauthenticated public endpoint, and
**recomputable**, because a re-executing step must produce the same callback URL
it gave the provider the first time. An HMAC over the derived wait key is both.

The key comes from `WAIT_CALLBACK_SECRET`, falling back to
`SECRET_ENCRYPTION_KEY` — already required in production, already secret, and
used here only through a non-reversible derivation. With neither configured,
`callbackTokenFor` returns null and the resolver **refuses to offer a callback
at all**, rather than publishing a guessable URL.

---

## 3. Async tools

An HTTP tool spec may declare an `async` block: where the submit response
carries the provider's handle, how to poll, and which input carries the callback
URL.

```
submit → handle → park (worker released) → callback OR poll → resolve → resume
```

**Both completion paths, always.** A callback that never comes must not park a
run forever, and a provider that only polls must still work. So the wait carries
a poll schedule *and* a callback token whenever both are configured, and
whichever arrives first resolves it. The other then finds the wait already
resolved and does nothing, because:

**Resolution is a compare-and-set on `status = 'waiting'`.** A redelivered
callback — and providers redeliver — updates zero rows the second time. The
route reports `200`, not a `4xx`: the provider did its job, the outcome it is
telling us about is already recorded, and answering with an error would make a
well-behaved provider retry a delivery that already succeeded.

**A duplicate callback therefore resolves the wait exactly once**, and this is
asserted rather than reasoned about (`WaitPrimitiveTest`).

### 3.1 Precheck on re-execution

When a parked node re-executes, `AsyncToolProtocol.verdictOf` reads the existing
wait before doing anything:

| Verdict | Meaning |
|---|---|
| `Submit` | no wait exists — submit the work |
| `AlreadyResolved` | the answer is in; project it and continue |
| `StillWaiting` | park again without resubmitting |
| `Unavailable` | the spec declares async but the runtime cannot honour it |

`StillWaiting` is the arm that makes a spurious resume free: the run re-executes
the node, finds its own wait, and parks again — no second submission, no second
charge from the provider.

### 3.2 The callback rules travel on the wait

`POST /api/tool-callbacks/:token` lives in the API. It has no access to the
tool's spec and cannot look one up — the wait row is all it has. So the spec's
`callback` block (status path, completed and failed vocabularies, result and
error paths) is written into `run_waits.metadata_json` when the wait is opened,
and the route reads its rules from there.

With no rules the route falls back to "any delivery is a completion", which is
right for a provider that posts a bare result object and wrong for everyone else:
a progress ping resolves the wait and resumes the run with a half-finished render
presented as the answer, and `{"status":"failed"}` is recorded as a success. The
rules are captured at OPEN time rather than read later, because a tool can be
re-versioned while a six-minute job is in flight and the delivery has to be read
by the rules the submit was made under.

---

## 4. Signals

`POST /api/runs/:id/signals` with a name and a payload.

- **Workspace-scoped and authenticated.** The route resolves the run inside the
  caller's workspace or answers 404 — a run id from another workspace is not
  merely rejected, it does not exist to the caller (invariant 8).
- **Durable and ordered.** Each signal takes a per-run `sequence`. Delivery
  order is send order, not arrival-at-worker order.
- **Deduplicated.** An optional `dedupe_key` has a unique partial index. A retried
  send is `Duplicate`, not a second signal.
- **Delivered at a step boundary, or it resumes the run.** To a *parked* run
  matching on `signal_name`, it resolves the wait and enqueues a resume. To a
  *running* run it sits unconsumed until the runtime reads it at the top of its
  next iteration. To a *terminal* run it is refused with a message that says the
  run has finished — silently accepting a signal nothing will ever read is worse
  than an error.
- **Rate limited, per run as well as per workspace** — 60/min and 600/min.
  Every signal to a parked run enqueues a resume, so an unbounded stream would
  make one run consume a worker permanently while making no progress. The run
  belongs to the sender's own tenant, so a purely global limit would not catch
  it.
- **In the trace.** Signals appear as `SIGNAL_DELIVERED` events.

Payloads are capped at 64 KB. A signal is news, not a data transfer.

---

## 5. Agent-visible waits

The model may emit a `WAIT` action with a signal name and a timeout. It goes
through the same validation as every other action — invariant 1, the model
chooses and the runtime executes — and produces an `agent_wait`.

**Behind `AGENT_WAIT_ACTION_ENABLED`, default off.** The flag does two things,
and both are needed. It removes `WAIT` from the prompt's action list, because
describing an action the deployment will refuse costs tokens on every iteration
and teaches the model to ask for something it cannot have. And it makes the
runtime refuse a `WAIT` that arrives anyway — an off switch that only edits the
prompt is not an off switch, since the model's output is not the authority on
what may run.

Nothing else in this feature is flagged: an HTTP tool with no `async` block
behaves exactly as it did, and a signal requires somebody to call a new endpoint.
`WAIT` is the one part that changes what every existing agent could do the moment
it deploys.

`openAgentWait` checks for an **already-pending signal before opening the wait**.
Without that check a run told "wait for `approval_received`" moments after that
signal arrived would park behind an event that had already happened, and stay
parked until its timeout.

The loop stops with `StopReason.WAITING`, which the failure taxonomy classifies
as `Classification.Waiting`, **not** a failure. A six-minute render in progress
is not a fault, and filing it as one would put working runs in the failure
metrics and on somebody's dashboard.

---

## 6. Timeouts, and why waiting is free

Every wait has a deadline. `RUN_WAIT_DEFAULT_MS` is one hour; `RUN_WAIT_MAX_MS`
is seven days. A requested timeout beyond the maximum is **clamped, not
rejected** — a tool asking for eight days gets seven and works, rather than
failing at submit time over a number nobody chose deliberately.

`WaitSweeper` runs every `WAIT_SWEEPER_INTERVAL_MS` (15s) and does two things:
expires waits past `timeout_at`, and polls the ones with a poll schedule. An
expiry message names the elapsed time *and* the deadline, because "timed out"
without either tells an operator nothing about whether the deadline was wrong or
the provider was.

**Waiting costs no wall-clock budget, by construction rather than by
subtraction.** `RunCeilings.active_ms` accumulates only during ticks, and
opening a wait ends the tick. There is nothing to exclude, because nothing was
ever counted. `agent_runs.waiting_ms` exists purely so the timeline can say how
long the run was parked; no ceiling reads it.

---

## 7. Recovery

Durable state can change while the process that should have acted on it dies.
`ResumeReconciler` sweeps for exactly that, and has an arm per failure shape:

| Reason | The disagreement it finds |
|---|---|
| `wait_resolved` | a wait resolved beside a run still parked, and no resume was enqueued |
| `wait_expired` | a wait past its deadline that the sweeper never got to |
| `signal_pending` | an unconsumed signal beside a run parked on that name |

The sweep is **conservative**: it wakes a run only when *no* wait on it is still
open. A fan-out with one branch finished and one still rendering is correctly
parked, and waking it would start a resume loop against a job that is going
perfectly well. `NOT EXISTS (… still waiting)` expresses that;
`EXISTS (… resolved)` would not.

`WaitReconciliationTest` walks `WaitKind.entries` rather than a hand-written
list. A list here would be a list somebody forgets to extend, and the symptom of
forgetting is runs of the new kind parked forever with nothing sweeping them —
invisible until a customer notices.

### 7.1 The reason column is constrained

`run_resume_attempts.reason` has a CHECK constraint (added in V045). The three
new reasons had to be added to it in V065 by DROP + ADD; without that the sweep
found the stranded runs and then threw on the first insert, recovering none of
them. Anything adding a fourth reason must extend that constraint in the same
migration.

---

## 8. What the operator sees

| Surface | What it shows |
|---|---|
| Runs list | status **Waiting** — its own badge, not "Queued" and not "Awaiting approval" |
| Run detail | a banner naming each active wait: label, elapsed, deadline, provider handle |
| Run detail | `GET /api/runs/:id/waits`, reading the `run_active_waits` view |
| Timeline | `RUN_WAIT_STARTED` / `RUN_WAIT_RESOLVED` bracket the span; `RUN_WAIT_TIMED_OUT` and `SIGNAL_DELIVERED` alongside |

**`waiting` is a distinct UI status.** `queued` claims the platform has not
picked the run up, which is false and reads as queue depth — it sends somebody
to scale workers that are already idle. `awaiting-approval` claims a person must
act, which sends them looking for an approval queue that does not exist. Both
were wrong in ways that cost time, so the third answer exists. `waiting_for_timer`
and `yielded` moved onto it too; they were always parked rather than pending.

The banner shows the deadline in three genuinely different forms — a remaining
duration, "No deadline set", and "Overdue — being timed out". Collapsing any two
loses the thing the field is read for.

---

## 9. Configuration

| Variable | Default | What it does |
|---|---|---|
| `WAIT_CALLBACK_SECRET` | falls back to `SECRET_ENCRYPTION_KEY` | HMAC key for callback tokens. Unset ⇒ no callbacks offered. |
| `RUN_WAIT_DEFAULT_MS` | 1 hour | Deadline when a wait requests none. |
| `RUN_WAIT_MAX_MS` | 7 days | Ceiling; longer requests are clamped. |
| `WAIT_SWEEPER_ENABLED` | `true` | Set `false` to disable the sweeper. The reconciler still recovers expired waits, more slowly. |
| `WAIT_SWEEPER_INTERVAL_MS` | 15000 | Sweep period. |
| `AGENT_WAIT_ACTION_ENABLED` | `false` | Offers the agent-visible `WAIT` action, and makes the runtime accept it. |
| `PUBLIC_API_BASE_URL` | unset | The origin a provider calls back on. Unset ⇒ no callbacks offered, polling only. |

---

## 10. Rules for changing this

- **The wait key derivation is on CLAUDE.md's stop-and-ask list.** It is
  idempotency key derivation by another name, and a plausible-looking change
  produces duplicate side effects in production.
- **A new wait kind needs four things**: an entry in `WaitKind` with a parked
  status the resume CAS accepts, a reconciler arm, a `run_waits_kind_check`
  update, and a classification in `StopReasonTaxonomy` that is not a failure.
  `WaitReconciliationTest` and `StopReasonTaxonomyTest` both fail until it has
  them.
- **Resolution stays a CAS on `status = 'waiting'`.** Exactly-once delivery of a
  redelivered callback rests entirely on it.
- **Never let a wait be opened without a deadline.** The clamp exists so that
  asking for too long is survivable; asking for nothing must not be.

---

## 11. Known gaps

**Cancelling a parked run does not take effect until it wakes.** `POST
/api/runs/:id/cancel` sets `cancellation_requested`, and the worker reads that
flag between DAG iterations — a parked run is not iterating, and
`cancellation_requested` is not in the resume CAS's accepted set, so the run does
not move until something else resumes it.

This predates waits (it is the existing behaviour for `waiting_for_approval`)
and `waiting_for_event` was deliberately **not** added to `CANCELLABLE_STATUSES`
rather than propagate it. Fixing it means either taking a parked run straight to
`cancelled` — legitimate, since it holds no worker and no lease — or admitting
`cancellation_requested` to the CAS. Both touch the run status state machine,
which is stop-and-ask.

---

## 12. The approval gate is not yet on this primitive

The brief's own framing is that a wait is "exactly what the approval gate already
does", and the intended end state is that approval becomes one kind among four
rather than a parallel mechanism. Three of the four kinds run through
`run_waits` today. Approval does not.

**Not because it is hard — because it is on the stop-and-ask list.** Moving it
touches three of the six things CLAUDE.md names explicitly: the shape of an
approval key, `decideOnApproval`, and what happens on resume. The specific hazard
is a double resume: an approval decision enqueues a resume today, and a wait
resolution enqueues one too, so a migration that does both without deciding which
owns the enqueue produces exactly the duplicate-side-effect class those rules
exist to prevent.

**The shape it should take**, when it is decided:

- The `approvals` row stays. It is the human-facing artifact — who was asked,
  what they were asked, what they decided, when — and none of that belongs in a
  parking table.
- A `run_waits` row of kind `approval` becomes the PARKING half: the derived key,
  the deadline, the reconciler arm, the resume trigger.
- `decideOnApproval` resolves the wait, and the wait resolution is the single
  thing that enqueues the resume. One owner, not two.
- The approval key shape does not change. `RunWait.keyFor` and the approval key
  are derived from the same material for the same reason, so they can coexist
  without either being redefined.

Until then the two mechanisms run side by side, which costs one duplicated
concept and no correctness: approvals resume through the path they always have,
and `WaitReconciliationTest` already walks `WaitKind.entries`, so the approval arm
is covered the day the gate starts writing rows.
