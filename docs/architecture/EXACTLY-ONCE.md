# Exactly-once guards, and the chaos suite that tests them

The queue delivers at-least-once. The product sends emails, writes to customer
databases, and acts on users' behalf. Without the guards below a redelivery sends
the email twice — a customer-visible incident, not a bug report.

**Headline: duplicate side effects under chaos = 0**, measured from actual HTTP
requests received by an external recorder, not from the system's own bookkeeping.

> **Note on the brief.** It asks for `05-BACKEND-ARCHITECTURE.md` §2.6. That file
> is not in the repo and never has been — no file, no deletion in git history;
> only `01`, `02` and `09` exist. Doc 09 §0 explicitly *retracts* 05's claim on
> this exact topic ("You need to build idempotency and fencing from scratch" →
> "**Mostly built.** Fencing needs one gap closed (§6.3)"), so the surviving
> guidance is 09 §6.3, which this work follows. The prompt's own spec was
> self-contained, so nothing was blocked.

---

## 1. What was already there

Worth stating, because it shaped the design:

- `run_leases` with `lease_token`, `ON CONFLICT … WHERE expires_at < now()`
- CAS on status transitions
- XACK-last
- `step_executions` with `UNIQUE (run_id, node_id, attempt)` — node-level
  idempotency across crash recovery

So this was not built from scratch. What was missing: fencing on the *other*
writes (09 §6.3), a record of external calls, a ceiling on redelivery, and any
test that broke things on purpose.

---

## 2. Fencing (`Fence`, `fenced_write_total`)

A worker can lose its lease without noticing — a GC pause, a network blip, or
simply taking longer than the TTL. The lease expires, another worker legitimately
claims the run, and the first one is still writing.

`Fence` carries the run, worker and lease token, and `assertWrote(rows, what)`
turns "zero rows affected" into `FencedOutException`. The rule has no exceptions:
**abandon, log, do not retry, do not write anywhere else.** The exception type is
deliberately not something a `catch (e: Exception)` retry loop would recognise —
zero rows is not a transient failure, and retrying it is a second worker fighting
the rightful owner.

`fenced_write_total{operation}` is the alert. A non-zero *rate* means leases are
being lost while work is still running: either the TTL is too short for the
workload or workers are overloaded enough to miss heartbeats. Either way runs are
being executed twice up to the point of the fence.

---

## 3. Idempotency (`SideEffectGuard`, `side_effects`)

### The window

Between "the email was sent" and "we recorded that the email was sent" there is a
gap. A crash there leaves the effect done and the system believing it is not.

### The protocol

1. `INSERT … status='in_flight'` under a unique key — a pure test-and-set, so
   exactly one attempt across the fleet wins
2. conflict on `succeeded` → replay the stored response, **skip the call**
3. conflict on `in_flight` → someone is mid-call; wait with backoff, re-check
4. perform the call, store the response, mark `succeeded`
5. on failure mark `failed`, which permits a genuine retry

### The part that is easy to get subtly wrong

The key is `SHA-256(run_id | node_id | attempt_group)` — **`attempt_group`, not
`attempt`**. `attempt` increments on every automatic retry, so a key derived from
it would be different on each retry and every retry would miss the dedupe. The
mechanism would look present and do nothing. `attempt_group` increments only on
user-initiated re-runs, so retries share a key and dedupe, while a deliberate
re-run gets a fresh key and genuinely sends a second email — which is what the
user asked for.

The key is passed through as an `Idempotency-Key` header so providers with native
idempotency (Stripe-style, OpenAI) dedupe on their side too: ours stops the
second call being made, theirs stops it counting if it somehow is.

### One deliberate asymmetry

A **timeout** does not mark the row `failed`. The request may have reached the
endpoint, so the row stays `in_flight` and the next attempt gets `Undetermined`
and **fails the node rather than risk a duplicate**. A connection refusal *does*
mark `failed`, because the request demonstrably did not land.

That is the right trade for an email or a payment, and it is why the chaos runs
show a small number of failed runs. Those are the mechanism working, not
breaking.

---

## 4. Lease heartbeat

Fixed **10 s**, not TTL/3. The old schedule was 20 s at a 60 s TTL — three beats
of margin, and one GC pause from losing the lease mid-step.

The important half is the failure path: zero rows updated means the lease was
reassigned, so the run's coroutine is **cancelled immediately** rather than
allowed to finish and write. Cancellation is defence in depth — anything it
attempts afterwards is fenced anyway.

---

## 5. Poison-job protection (`dead_letters`)

A job that crashes its worker gets reclaimed and crashes the next one. One
malformed payload takes down the fleet indefinitely, and because each crash looks
like an infrastructure blip it usually gets diagnosed as one.

`delivery_attempts` is counted **at claim, before execution** — a job that
crashes the process never reaches any post-execution bookkeeping, so counting
afterwards would never fire. Past `max_attempts` (default 5) the job lands in
`dead_letters` with the full payload, the **error chain across every attempt**,
and worker context, and the run is marked terminal so nothing re-enqueues it.

The counter lives in Postgres, not the Redis message: an XAUTOCLAIM reclaim
replays the original fields, so a message redelivered by reclaim comes back with
the same `retryCount` it had the first time and a Redis-side ceiling would never
be reached.

Surfaced at `GET /api/incidents/dead-letters`. Acknowledge only — deliberately
**no replay button**: re-running a job that has already crashed several workers,
from a UI, before anyone has read the payload, is how one poison job becomes an
outage twice.

---

## 6. Chaos suite (`scripts/chaos/`)

### The oracle

Duplicates are counted by `side-effect-recorder.mjs` — an external HTTP server
that records every request it receives, keyed by the `Idempotency-Key` header.
Counting rows in `side_effects` would only prove the worker's bookkeeping is
self-consistent; it would happily report zero duplicates while sending two
emails, because the duplicate is precisely the call the bookkeeping missed.

The recorder also flags **unkeyed calls** as a failure in their own right: a side
effect that went out without passing through the guard cannot be deduped by
anything.

### Guarding against a vacuous pass

`assertChaosActuallyHappened` fails the scenario if nothing was killed, nothing
ran, or no side effects were attempted. A green run that proves nothing is worse
than a red one, because it gets believed. This assertion earned its place — see
`lease-expiry` below.

### Results

| Scenario | Faults | Runs | Side effects | Duplicates | Result |
|---|---|---|---|---|---|
| random-kills | 3 | 12 | 24 | **0** | PASS |
| kill-during-side-effect | 2 | 3 | 3 | **0** | PASS |
| lease-expiry | 0 | 3 | 6 | **0** | **FAIL — fault unavailable** |
| postgres-partition | 1 | 6 | 12 | **0** | PASS |

**DUPLICATE SIDE EFFECTS ACROSS ALL SCENARIOS: 0**

---

## 7. Two honest caveats

### `lease-expiry` did not run

Windows has no SIGSTOP for a JVM, so the pause fault could not be injected. The
scenario correctly reported `SUITE IS VACUOUS: no workers were killed` and
**failed** rather than reporting a clean sweep of assertions it never tested.

This is the scenario that exercises split-brain — a frozen worker waking up
believing it still owns a run another worker has taken over — and it is the only
one that directly tests fencing. **It must be run on Linux before this is
trusted.** On Linux `kill -STOP` / `kill -CONT` work as written.

### The dedupe counter read zero under chaos, so I tested it directly

The chaos suite reported zero duplicates *and* zero dedupe events. Both true, and
the second is the interesting part: the dedupe path never ran, so the suite proved
no duplicates occurred without proving the mechanism meant to prevent them.

The cause is layering. `StepExecutionGuard` short-circuits a retry at the **node**
level — if the step already succeeded the node is skipped and
`SideEffectGuard.begin()` is never called again. That is the first line of defence
and it caught every crash the suite injected.

`SideEffectGuard` is the second line, covering the window the first cannot: the
side effect succeeded and was recorded, but the worker died before
`step_executions` was marked complete. Hitting that window by random killing is a
coin flip; asserting it is not.

`SideEffectGuardIntegrationTest` asserts it directly against a real Postgres —
**5 tests, 0 skipped, 0 failures**:

| Test | Proves |
|---|---|
| completed effect deduplicates and increments the counter | `side_effect_dedupe_total` 0 → 1, stored response replayed |
| failed effect permits a genuine retry | transient failures are not stranded |
| in-flight effect is never raced | a duplicate email is worse than a delayed one |
| key stable per attempt_group, changes across groups | retries dedupe; re-runs genuinely re-run |
| key is header-safe and identifiable | survives as `Idempotency-Key` |

That is the "non-zero dedupe counter" the brief asks for, obtained deterministically
rather than by hoping a random kill lands in a millisecond-wide window.

---

## 8. One real defect the suite found

`lease-expiry` reported **one lease held on an already-terminal run**
(`993b6711@load-worker-2`) — all three runs succeeded, but a lease outlived its
run. It expires on its own after the 60 s TTL, so this is a transient capacity
leak rather than a correctness problem: for up to a minute that workspace is
counted against its concurrency limit for work that has finished.

Not yet root-caused. Most likely the `finally` that releases the lease did not
complete on a cancelled coroutine — which would be a real consequence of the
S04 switch from `Future.cancel` to structured cancellation, and is exactly the
shutdown-under-load behaviour flagged as needing testing in `SUSPENDING-IO.md` §5.

Worth chasing before the next load milestone. It is logged as D10 in
`TECH-DEBT.md`.

---

## 9. Status

`gradle test` — **192 tests, 0 failures, 0 skipped**. API compiles.

| Item | Status |
|---|---|
| 1 · Fencing tokens + `fenced_write_total` | ✅ mechanism built; **enforcement not yet threaded through every write path** |
| 2 · Idempotency keys | ✅ done, wired into `HttpNodeExecutor`, proven by direct test |
| 3 · Lease heartbeat 10 s + cancel | ✅ done |
| 4 · Poison-job protection + dead letter + Incidents API | ✅ done |
| 5 · Chaos suite | ✅ 3 of 4 scenarios pass; `lease-expiry` needs Linux |

### The fencing gap, stated plainly

`Fence` and `FencedOutException` exist and `fenced_write_total` is wired, but the
`AND lease_token = ?` predicate has **not** yet been added to `run_events`,
`step_outputs`, `run_checkpoints` and `agent_iterations` — the four writes 09 §6.3
names. `RuntimeContext` now carries `leaseToken` so the plumbing is in place, but
the write sites still need changing, and `fenced_write_total` will read zero until
they are.

Fencing is therefore **not yet enforced** on those paths. Two things partly cover
the gap today — the step-execution guard and the 10 s heartbeat's cancellation —
but neither is fencing, and the `lease-expiry` scenario that would have exposed
it is the one that could not run on this host.

**Next, in order:** add the predicate to those four writes; re-run the chaos suite
on Linux with `lease-expiry` active; confirm `fenced_write_total` moves.
