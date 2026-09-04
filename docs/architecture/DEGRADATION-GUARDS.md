# Graceful degradation under stress

Implements §5.1–5.3 of the backend architecture spec.

> A user who sees "you're #47 in queue, about 3 minutes" trusts you; a user whose
> run sits in `queued` silently for twenty minutes writes a bad review.

Both are the same amount of waiting. Only one of them is honest about it. Every
guard below exists to keep the system in the first category when it is under more
load than it can serve.

**Note on the source document.** `/docs/architecture/05-BACKEND-ARCHITECTURE.md`
does not exist in this repository — the same gap as §2.6 in the exactly-once work.
This is built from the specification in the request itself, which was detailed
enough to implement against directly.

---

## 1. What was built

| # | Guard | Where | Wired |
|---|---|---|---|
| 1 | Admission control | `api/admission/AdmissionControl.kt` | `RunRoutes.trigger` |
| 2 | Run-level ceilings | `worker/runtime/budget/RunCeilings.kt` | `WorkflowRuntime.runDag` |
| 3 | Token-bucket rate limiting | `api/rate/TokenBucket.kt` | `RunRoutes` + `HttpServer` |
| 4 | Circuit breakers | `worker/net/ConnectionCircuit.kt` | `LlmNodeExecutor` via registry |
| 5 | 429 → suspend | `worker/net/ProviderThrottle.kt` | `RunProcessor` + `workflow_timers` |
| 6 | Demo lane | V023/V025 + `PostgresClaim` | `ClaimConsumer` reserved permits |
| 7 | Schedule anti-stampede | `api/schedule/*` | `WorkflowScheduler.tick` |
| 8 | Status endpoint | `api/routes/FleetStatusRoutes.kt` | `GET /api/status` |

Schema: `V025__degradation_guards.sql`.

---

## 2. Admission control

Evaluated at run creation, before the row exists.

| Condition | Outcome |
|---|---|
| class queue depth < 100 | accept; no position, no ETA |
| 100 ≤ depth ≤ 500 | accept **with** `queuePosition`, `etaSeconds`, `degraded: true` |
| workspace at its concurrency cap | reject `429 WORKSPACE_CONCURRENCY_LIMIT` |
| global depth > 2000 | reject `503 QUEUE_SATURATED` — **priority lane exempt** |

**Ordering is deliberate.** The workspace check runs before the global one. A
tenant at their own cap should be told *that*, even during a platform-wide surge,
because it is the constraint they can act on. "The platform is busy" when your own
eight runs are the problem sends you to the wrong support article.

**It fails open.** If the snapshot query fails, the run is admitted. An admission
check that cannot reach the database must not become an outage of its own — the
claim still enforces the per-tenant cap atomically, so the worst case is a run
that queues when it could have been rejected politely.

### Structured errors, never a bare 500

`ApiError` gained a `details` map and `ErrorResponse` renders it:

```json
{
  "error": {
    "code": "WORKSPACE_CONCURRENCY_LIMIT",
    "message": "Workspace concurrency limit reached (8 concurrent runs). 12 runs queued.",
    "requestId": "f3a2…",
    "details": { "limit": 8, "active": 8, "queued": 12, "retryable": true }
  }
}
```

The message is a toast. The details are a progress bar, a queue position, and an
upgrade prompt that names the right number. `Retry-After` is set automatically for
any error whose details carry `retryAfterSeconds`, so a well-behaved client backs
off correctly without each throw site remembering to add the header.

`QUEUE_SATURATED` is a **503, not a 429**, on purpose: nothing about that caller is
wrong, and a 429 would tell them to slow down when slowing down is not the remedy.

### Queue position and ETA

`GET /api/runs/:id/queue-position` (built in the previous stage) is the refresh
endpoint; admission returns the first snapshot inline so the UI has something to
show immediately.

ETA is **measured, not modelled** — completions per second for that class over the
last five minutes. A model of "n runs × average duration ÷ pool size" is wrong the
moment the fleet is resized. Null when nothing has completed recently: an ETA
computed from no data is a guess, and printing a guess is how you lose the trust
the ETA existed to build.

---

## 3. Run-level ceilings

| Dimension | Default | Terminal status |
|---|---|---|
| Steps | 200 | `step_limit_exceeded` |
| Active wall clock | 1h | `duration_limit_exceeded` |
| Cost | $1.00 (100 cents) | `cost_limit_exceeded` |
| Tokens | 1,000,000 | `token_limit_exceeded` |
| Node payload | 256KB | `payload_limit_exceeded` |

Per-plan overrides in `workspace_usage_policies`.

### Why this is not the tick budget

`ExecutionBudget` already existed and does something different. It answers "has
this tick gone on long enough that the worker should checkpoint and yield?" —
a scheduling courtesy. Exceeding it is normal and free.

A ceiling answers "has this run consumed more than it is allowed to?" — a
contract. **An agent in an infinite loop passes the tick budget cleanly, forever.**
It yields, resumes, yields, resumes, each tick well behaved, the run immortal. The
tick budget was never going to stop it.

### Counters live in Postgres

A run executes as a sequence of ticks, possibly on different workers, possibly
hours apart across a suspension. Counters in a tracker reset at every
`RESUME_RUN`, so the loop would reach step 200 on every tick and never on the run.
`agent_runs.steps_executed / active_ms / cost_cents / tokens_used` is the only
thing that survives — read at tick start, accumulated in memory, flushed at every
yield and at the terminal transition.

### Active time, not wall time

`active_ms` accumulates only while a tick is executing. A run waiting three days
for an approval holds no permit and costs nothing; charging it wall-clock time
would make "max 1 hour" mean "no workflow may wait for a human", which is the
opposite of what a durable engine is for.

### Each breach is its own terminal status

Not a shared `failed`. "Your run failed" is a support ticket; "this run reached its
$1.00 cost limit after 47 steps" is an answer, and the UI can offer the right next
action for each:

> This run executed 200 steps, its maximum. This usually means an agent or loop
> node is not reaching its exit condition — check the loop's termination check.

`error_json` carries `retryable: false`, because retrying a run that hit its cost
ceiling spends the money again to reach the same place.

---

## 4. Rate limiting — token bucket

Redis, refilled continuously, consumed atomically via Lua.

| Bucket | Key | Default |
|---|---|---|
| Run creation | `run-create:<workspace>` | 60/min, burst 120 |
| API requests | `req:<principal>` | 600/min, burst 1200 |
| Outbound per connection | `connections.max_calls_per_second` | NULL = unlimited |

### Why not the fixed window already in the codebase

`RedisRateLimiter` counts per fixed window, which has two problems users hit:

- **The boundary burst.** 60/minute admits 60 at 11:00:59 and 60 more at 11:01:00 —
  120 requests in one second, twice the limit, without ever exceeding it. Under a
  stress test that is exactly when things break.
- **No burst allowance.** A workspace idle for an hour is allowed no more at 11:00
  than one hammering since 10:00, which punishes the polite usage pattern.

### Atomicity

Refill-then-consume is read-modify-write. Two API replicas doing it with separate
GET/SET both read the same token count and both spend it — the limit silently
doubles per replica, the same multiply-by-replicas bug the tenant limiter had. The
Lua script makes it one round trip Redis executes without interleaving.

Fails open on Redis error: admission and the per-tenant cap are both still in
front of the queue.

**On "per API key":** this codebase authenticates with Supabase JWTs and has no
API-key concept, so the bucket is keyed on the authenticated app user — the
closest true identity. When API keys arrive, the key becomes the identity and
nothing else changes. Unauthenticated requests are not bucketed: they have no
stable identity, and bucketing by IP would rate-limit an entire office behind one
NAT.

---

## 5. Circuit breakers

Per connection. Five consecutive failures opens it; 30s cooldown; then one
half-open probe.

**What it is actually for.** A provider that is down does not fail fast — it fails
*slowly*. Every call burns its full timeout before failing, so a dead endpoint
converts a 30-second socket timeout into 30 seconds of held permit, per call, per
run. Twenty runs pointed at that connection consume twenty permits doing nothing.
Opening the circuit turns those 30 seconds into microseconds.

**The half-open state is what makes it recover.** Without it a breaker either stays
open forever or reopens the floodgates all at once onto a provider that may still
be struggling — and a thundering herd of retries is how a recovering service is
knocked back down. Exactly one probe is allowed through, guarded by a CAS.

**State is written to `connections`.** `circuit_state`, `consecutive_failures`,
`circuit_opened_at`, `circuit_last_error`, and `network_status` flip to
`unhealthy`. That is what turns a backend guard into the blast-radius view in the
Connections UI — a breaker whose state lives only in a worker's heap protects the
fleet and tells the customer nothing.

Counting is per worker, deliberately: sharing the counter would put a write on
every failure, and containment is achieved once each worker independently stops
calling.

---

## 6. Provider 429 → suspend, not sleep

**The mistake this exists to prevent.** The obvious handling is
`sleep(retryAfter); retry`. The run keeps its permit for the whole backoff, so a
provider asking for a 60-second pause removes a worker slot for 60 seconds — and
when twenty runs hit the same rate limit at once, twenty slots disappear on a
condition that is not even an error.

So a 429 **suspends** the run into `workflow_timers`, the same durable mechanism an
approval uses. `NodeResult.Throttled` → `ExecutionResult.Throttled` → status
`yielded` + a timer at `now + delay`. The permit is released the moment the
processor returns.

- `Retry-After` is honoured in both forms — delta-seconds and HTTP-date. A provider
  that tells us exactly when to come back is doing us a favour, and second-guessing
  it is how you get rate-limited twice.
- Absent or unparseable → exponential backoff with **full jitter** (uniform draw
  from `[base, cap]`). Adding a small random delta to a common base still leaves
  every caller in the same window — the thundering herd with extra steps.
- Below a 2s threshold it backs off in place: suspend/resume writes a timer row,
  releases the permit, re-queues, re-claims and reloads the checkpoint, which is
  far more expensive than simply waiting 200ms.
- Status is `yielded`, the state crash recovery already understands, so a worker
  dying between the status change and the timer write still leaves a run the
  recovery sweep re-enqueues. The timer is the fast path, not the only path.

---

## 7. Demo lane

- `workspace_usage_policies.priority_lane` → `FairOrdering` stamps `priority = 100`.
- The claim orders by `priority DESC, fair_vtime`, so priority work sorts ahead.
- `CLAIM_RESERVED_PRIORITY_SLOTS` (default 1 per pool; `reserved_slots` default 20
  for priority-lane workspaces) permits are held open at all times.
- Admission's global shedding threshold exempts `priority >= 50`.

Enabling it, half an hour before a demo, with no deploy:

```sql
INSERT INTO workspace_usage_policies (workspace_id, priority_lane, reserved_slots)
VALUES ('<workspace-id>', true, 20)
ON CONFLICT (workspace_id) DO UPDATE SET priority_lane = true, reserved_slots = 20;
```

Takes effect on the next enqueue. It does **not** re-prioritise already-queued runs —
`priority` and `fair_vtime` are stamped at trigger — so flip the flag before
triggering.

Measured in the previous stage: priority probe **0.01s** vs ordinary **9.57s** with
35 runs queued behind a saturated pool.

---

## 8. Schedule thundering herd

**Deterministic jitter.** `schedules.jitter_seconds`, derived from `workflow_id`:

```sql
('x' || substr(md5(workflow_id::text), 1, 8))::bit(32)::bigint % 60
```

Stable per workflow, spread across the fleet, no coordination. Applied in the *due
predicate*, not by advancing `next_fire_at` — baking it into the stored time would
compound, and the schedule would drift a minute per day off the cron the user
wrote.

Random-per-tick jitter would be worse than the stampede: "why did my 9am report
arrive at 09:00:43 today and 09:00:12 yesterday" is a real complaint.

**Overlap policy**, enforced from `schedules.active_run_id`:

- `skip` (default) — do not fire while the previous run is in flight. Right for a
  sync job where two concurrent copies corrupt each other.
- `queue` — fire anyway; admission and the per-tenant cap decide when it runs.
- `allow_concurrent` — no check.

Checked *before* the claim so a skipped occurrence still advances `next_fire_at` —
skipping without advancing would leave the schedule permanently due.

**Exactly-once firing** across API instances was already correct via
`claimAndAdvance`, a guarded `UPDATE`. Confirmed, not rebuilt.

**Bug fixed in passing:** scheduled runs were bypassing fair-queue placement, so
they carried `fair_vtime = 0` — which the claim reads as the front of the queue. A
workspace with fifty schedules would have preempted every interactive run on the
platform at 09:00.

---

## 9. `GET /api/status`

Extended with the half of system health workers cannot report:

```json
{
  "status": "busy",
  "fleet": { "live": 3, "capacity": 24, "activeTasks": 24, "headroom": 0, "utilization": 1.0 },
  "queue": {
    "depth": 143, "inFlight": 24,
    "byClass": { "short": 120, "agent": 23 },
    "oldestQueuedSeconds": 41,
    "throughputPerMinute": 62
  },
  "degradation": {
    "state": "busy",
    "acceptingRuns": true,
    "sheddingNonPriority": false,
    "message": "The queue is deeper than usual. New runs are accepted and return a position and an estimate."
  }
}
```

States: `healthy` · `busy` · `saturated` · `degraded` · `shedding` · `down`.

A fleet at 20% utilisation with 4,000 runs queued is **not** healthy — it is being
throttled by per-tenant caps — and a status derived from heartbeats alone would
call it healthy and be wrong in the direction that matters. Thresholds are read
from the same env vars admission uses, so the Control page and the trigger endpoint
cannot disagree.

`oldestQueuedSeconds` is the number to alert on: depth alone cannot distinguish a
healthy backlog moving fast from a stuck queue.

---

## 10. Verification

See §11 for the measured results. The harness is
`scripts/load/degradation.mjs`:

```bash
node scripts/load/degradation.mjs
```

It applies load in rising steps (1×, 2×, 5×, 10× the fleet's 8-slot short pool)
rather than one flood, because a single flood measures one point and this needs a
curve. Four assertions:

1. **Throughput plateaus** rather than collapsing. Graceful degradation keeps
   completing work at the maximum rate while the queue grows behind it; collapse
   completes *less* as load rises, because capacity goes to contention.
2. **Latency degrades predictably** — wait grows roughly linearly with depth, which
   is what makes an ETA possible.
3. **Nothing crashes** — the worker still serves `/metrics` at the end.
4. **No run is silently lost** — every submitted run is terminal, pending, or
   explicitly rejected at admission. A run that is none of those has vanished.

Admission rejections count as a **pass**, not a failure: shedding is the graceful
part of graceful degradation. They are counted rather than ignored, because a
rejected run must not also be missing.

---

## 11. Results

One worker, agent pool 6 permits, `WORKER_CLAIM_MODE=postgres`, load Postgres/Redis.

### The degradation curve

`scripts/load/degradation.mjs`. Load is against the agent pool's 6 permits using
the 8-turn agent shape. The short pool with a 5-step transform was tried first and
is **not** a valid test: a sequential enqueue loop drains as fast as it fills,
queue depth stays at zero, and the harness reports a pass having measured an idle
system.

| Load | Submitted | Completed in window | Throughput (runs/s) | Queue depth | Oldest wait |
|---|---|---|---|---|---|
| 1x | 6 | 6 | 0.13 | 0 | 0.0s |
| 2x | 12 | 12 | 0.27 | 0 | 0.0s |
| 5x | 30 | 25 | 0.55 | 0 | 0.0s |
| **10x** | 60 | 30 | **0.66** | 30 | 45.1s |

Pushed further to find the actual plateau:

| Load | Submitted | Throughput (runs/s) | Queue depth | Oldest wait |
|---|---|---|---|---|
| 10x | 60 | 0.58 | 20 | 60.1s |
| 20x | 120 | **0.66** | 105 | 60.2s |
| 30x | 180 | **0.58** | 245 | 120.7s |

**Throughput is flat within noise while queue depth grows 12x.** That is the shape
graceful degradation has: the system keeps completing work at its maximum rate and
the backlog absorbs the excess. Collapse would show throughput *falling* as load
rose, capacity going to contention rather than work.

Latency grows in step with depth (60s / 60s / 120s as the queue goes 20 / 105 /
245), which is what makes the ETA computable.

**Accounting across the 30x sweep: 360 submitted, 360 accounted for, 0 lost.** The
sweep's "queue drained" check failed only because 245 queued agent runs at
0.6 runs/s needs about 7 minutes and the harness allows 5; a follow-up confirmed
`queued=0 inFlight=0 completed=360 - DRAINED`.

| Check | Result |
|---|---|
| Throughput plateaus rather than collapsing | **PASS** - 0.58 runs/s at 30x vs 0.66 peak |
| Nothing crashed | **PASS** - worker still serving `/metrics` |
| No run silently lost | **PASS** - 0 unaccounted of 360 |
| Queue drains | **PASS** - 0/0 after the full drain |

### Admission control

`scripts/load/admission-check.mjs`, driven through `POST /api/workflows/:id/run`
against a live API. Thresholds lowered (`ADMISSION_GLOBAL_REJECT=25`) and **no
worker running**, so the queue can actually saturate.

| Scenario | Response |
|---|---|
| Idle | `202` - `{"queueDepth":0}`, no position, no ETA |
| Deep queue | `202` - `{"queueDepth":25,"queuePosition":26,"degraded":true}` |
| Workspace over cap | `429 WORKSPACE_CONCURRENCY_LIMIT` - `{"limit":1,"active":1,"queued":0,"retryable":true}` |
| Global saturation | `503 QUEUE_SATURATED` - `{"globalDepth":26,"threshold":25,"retryable":true}` |
| Priority lane, while shedding | `202` - admitted |

All five PASS. The last row is the one that matters for the demo lane: every
ordinary caller was getting 503 at that moment and the priority-lane workspace was
still accepted.

### Run ceilings

`scripts/load/ceiling-check.mjs`, `max_steps_per_run = 3` against an 8-turn agent
workflow that would otherwise succeed:

```
terminal status  : step_limit_exceeded
ceiling_breached : steps
steps executed   : 3
error            : {"code":"STEP_LIMIT_EXCEEDED","used":3,"limit":3,
                    "message":"This run executed 3 steps, its maximum. This usually
                     means an agent or loop node is not reaching its exit condition
                     - check the loop's termination check.",
                    "dimension":"steps","retryable":false}
```

All four PASS: terminal, dimension-named status, `ceiling_breached` recorded, and
an error that names the fix rather than saying "something went wrong".

### Circuit breaker

`scripts/load/circuit-check.mjs`, LLM connection repointed at a closed port.

| Run | circuit_state | consecutive_failures | Outcome |
|---|---|---|---|
| 0-3 | closed | 0 | call attempted, failed |
| 4 | **open** | 5 | threshold reached |
| 5-8 | open | 5 | **rejected by breaker, no I/O attempted** |

`network_status` flips to `unhealthy`, so it surfaces in the Connections
blast-radius view. All three PASS.

**One thing this test does not show.** A closed loopback port refuses instantly,
so the "slow failure becomes fast failure" saving - the actual reason breakers
exist - is not visible in the latency column (229ms closed vs 334ms open, both
dominated by claim/lease/event overhead rather than the call). The containment is
real and structural, since no socket is opened once the circuit is open, but
demonstrating the timeout saving needs a black-hole endpoint like `hang-db.mjs`
rather than a refused port. Recorded as a gap rather than claimed as a result.

### Status endpoint

Under the saturated, worker-less state above:

```json
{ "status": "down",
  "queue": { "depth": 27, "inFlight": 1, "byClass": {"agent": 27},
             "oldestQueuedSeconds": 8, "throughputPerMinute": 0 },
  "degradation": { "state": "down", "acceptingRuns": false,
                   "sheddingNonPriority": true,
                   "message": "No workers are running. Runs are being queued but nothing is executing them." } }
```

`acceptingRuns` was initially derived from `state != "down"`, which was wrong:
with no workers, runs *are* still accepted and queued, they simply do not execute.
It now derives from the shedding threshold, because "your request was refused" and
"nothing is executing" are different problems with different fixes.

### Not covered by these runs

Stated rather than implied:

- **Token buckets** are exercised incidentally (the buckets sat at 119/120 during
  the admission run, confirming they refill and are consumed) but have no
  dedicated test asserting the boundary-burst behaviour they exist for.
- **429 to suspend** has no end-to-end test. The mock upstreams never return 429,
  so `ProviderThrottle` and the `workflow_timers` suspension path are wired and
  compile-checked but unproven under load. This is the weakest link in this stage
  and is recorded as **D18**.
- **Schedule jitter and overlap policy** are verified by construction (the SQL
  expression was checked directly against Postgres, returning a stable 22 for a
  fixed workflow id) but not by firing ten concurrent schedules.

### A measurement note

The fill loop initially stopped at 20 runs with `TOO_MANY_REQUESTS`, which looked
like the new token bucket rejecting. It was not - it was the pre-existing beta
`max_runs_per_day` quota (default 20), a separate and older guard that fires
first. Reading the whole response tally rather than the first failure is what
distinguished them; the buckets were near-full the entire time.

---

## 12. Metrics

| Metric | Reading it |
|---|---|
| `run_ceiling_breach{dimension}` | `steps` climbing means agent loops in the wild are not reaching their exit conditions — a product problem the ceiling is only containing. |
| `circuit_opened` / `circuit_closed` | A provider incident, not a platform one. |
| `circuit_rejected` | The win being measured: each one is a call that failed in microseconds instead of burning a 30s timeout and a permit. |
| `provider_throttle_suspend{provider}` | Permits released instead of held through a backoff. |

`circuit_rejected` carries **no connection label** — connection ids are unbounded
and one Prometheus series per connection is how a metrics backend falls over. Which
connection is open is in `connections.circuit_state`, queryable and shown in the UI.
