# The Postgres-claim scheduler

Implements §3 of `09-EXECUTION-ARCHITECTURE-REVISED.md`.

This is a **simplification**, not added machinery. It deletes the Pending Entries
List, XAUTOCLAIM, the second crash-recovery path, and the advisory admission
cache — and in exchange makes four things possible that a stream structurally
cannot do, all of which the product already promises: priority lanes, weighted
fairness, queue position, and class routing as one indexed predicate.

Redis keeps its real jobs: rate limiting, caching, pub/sub for live run updates,
distributed locks. It stops being the scheduler.

---

## 1. Results

Measured on the S01 harness against the load Postgres/Redis, JDK 17, one worker
unless stated. Full method in `scripts/load/README.md`.

### Fairness — weighted vs FIFO (S01 test 4)

`node scripts/load/fairness-compare.mjs` runs scenario 4 twice against an
unchanged worker and changes exactly one thing: how `fair_vtime` is stamped.

| Metric | FIFO | Weighted fair | Change |
|---|---|---|---|
| Quiet-tenant wait p50 | 14.99s | 1.01s | **14.8× better** |
| Quiet-tenant wait p95 | 15.03s | 1.06s | 14.1× better |
| Quiet-tenant wait max | 15.03s | 1.06s | 14.1× better |
| Quiet ÷ flooder wait | 2.09 | **0.14** | — |

Under FIFO a quiet tenant waits *twice as long as the flooder itself* — it is
behind the entire burst. Under weighted fairness it is served in about one
service quantum.

**The measurement only works with the per-tenant cap raised.** At the shipped
defaults (`MAX_ACTIVE_RUNS_PER_TENANT=2`, short pool 8) the cap is the binding
constraint: a flooder can never hold more than 2 of 8 permits, so quiet tenants
are served in 0.02s under *both* orderings and the ordering has nothing left to
fix. That is worth stating plainly rather than quietly picking the configuration
that makes the number look good:

> **The admission cap prevents starvation. Weighted ordering decides who goes
> first among everyone the cap admits.** They solve different problems, and the
> table above is measured with the cap at 16 so the ordering is what varies.

Fairness ratio in the baseline table (completed runs, best÷worst) is *not* a
scheduling metric — it is fixed by how many runs each tenant submitted. Wait
before start is the number a customer experiences.

### Per-tenant limits still hold

| | Cap | Peak observed |
|---|---|---|
| Total per workspace | 2 | **2** |
| Per class (short) | 4 | **2** |

Scenario 4, 55 runs, single worker, all 55 completed in 50.4s at 1.09 runs/s.

### Claim latency

`node scripts/load/claim-latency.mjs`

| Class | claims | p50 | p95 | p99 |
|---|---|---|---|---|
| short | 183 | 4.1ms | **19.5ms** | 69.5ms |
| long | 60 | 7.1ms | 37.5ms | 85.0ms |
| agent | 60 | 7.4ms | 37.5ms | 85.0ms |
| system | 60 | 7.4ms | 37.5ms | 160.0ms |

Worst p95 across classes **37.5ms**, against the 100ms budget in §3.

Wakeups: `notify=110`, `safety_poll=59`. Notifications dominate, which is the
evidence that LISTEN is alive — see §5 on why that has to be checked rather than
assumed.

### Priority lane preempts under saturation

`node scripts/load/priority-lane.mjs` — one tenant floods 40 agent runs, the pool
saturates with 35 still queued, then a priority run and an ordinary run are
enqueued in the same instant.

| Run | Lane | Wait before start |
|---|---|---|
| probe | priority (priority=100) | **0.01s** |
| probe | ordinary (priority=0) | 9.57s |

**1169× sooner.** `claim_reserved_lane_total=1` confirms the run was claimed at a
moment when only the reserved permit was free — the reserve was used, not merely
configured.

### No duplicate execution in dual mode

`node scripts/load/dual-mode-check.mjs` — 3 replicas in `WORKER_CLAIM_MODE=dual`,
48 runs written to **both** Postgres and the typed streams.

| | |
|---|---|
| Runs enqueued | 48 |
| Reached terminal state | 48 |
| `RUN_STARTED` events | 48 |
| Distinct runs started | 48 |
| **Runs started twice** | **0** |

---

## 2. Two defects this work found and fixed

Both were in the claim's own admission check, and both would have shipped as
"the per-tenant limit is enforced" while it was not.

### D12 — the tenant gate was consulted, not enforced

`WHERE COALESCE(tl.active_total, 0) < cap` is evaluated once, against the load as
it stood when the statement began. Every row in the batch then passes it, so a
batch of 8 handed one workspace 8 slots against a cap of 2.

Fixed by making the check ordinal rather than boolean:

```sql
ROW_NUMBER() OVER (PARTITION BY r.workspace_id
                   ORDER BY r.priority DESC, r.fair_vtime) AS rn_in_tenant,
LEAST(cap_total - active_total, cap_class - active_class)   AS headroom
...
WHERE rn_in_tenant <= headroom
```

A workspace's Nth-best queued run is claimable only while N ≤ its remaining
headroom, so the cap holds *within* a batch as well as across batches. Window
functions cannot coexist with `FOR UPDATE` at the same query level, hence three
CTEs: rank, cut to budget, then lock the survivors with `SKIP LOCKED`.

### D13 — the claim→lease window

`tenant_load` counted live leases. The lease is taken by `RunProcessor`,
milliseconds *after* the claim. The loop claimed its 2, submitted them, came back
before either had leased, saw `active_total = 0`, and claimed 2 more.

Fixed by counting what a workspace actually occupies:

```sql
WHERE ar.status IN ('claimed', 'running')
  AND (rl.run_id IS NOT NULL OR ar.claimed_at > now() - make_interval(secs => ?))
```

The lease keeps the self-healing property — a dead worker's lease expires and the
run stops counting, with nobody cleaning up — and the grace window covers the
moments before the lease exists. The window matches `reclaimStale`'s threshold
exactly, so there is no interval where a run is invisible to both the limit and
to recovery.

### A measurement error worth recording

The first three attempts at the fairness numbers reported per-tenant concurrency
of 8, then 9, then 14. The cause was not the scheduler: `replicas.sh stop` only
knows the pids it launched itself, so each `start-worker.sh` invocation left the
previous worker running. Five workers were live. Any "the limit is broken"
conclusion drawn from those runs would have been wrong, and the fix — a teardown
that matches on the process command line — is now a prerequisite of every
measurement in this document.

---

## 3. Schema (V023, V024)

| Object | Purpose |
|---|---|
| `agent_runs.priority` | 0 ordinary, 100 priority lane. Threshold at 50. |
| `agent_runs.fair_vtime` | Virtual finish time — the claim order. |
| `agent_runs.claimed_by` / `claimed_at` | Who holds it, since when. |
| `agent_runs_claim_idx` | `(execution_class, priority DESC, fair_vtime)` partial on queued/yielded. |
| `agent_runs_claimed_stale_idx` | `claimed_at` partial on `status='claimed'` — the reclaim sweep. |
| `agent_runs_tenant_load_idx` | `(workspace_id, execution_class, claimed_at)` partial on claimed/running — the admission scan. |
| `workspaces.vclock` | Per-workspace virtual clock. |
| `workspace_usage_policies.plan_weight` | Divides the vtime increment. Weight 2.0 ⇒ served ~2× as often. |
| `workspace_usage_policies.priority_lane` | The demo lane. Runtime flag, no deploy. |
| `workspace_usage_policies.reserved_slots` | Per-workspace reservation (declared; the pool-level reserve is `CLAIM_RESERVED_PRIORITY_SLOTS`). |
| `notify_run_queued()` trigger | `pg_notify('run_queued', execution_class)` on insert. |

## 4. Weighted fair queueing, in one column

```
fair_vtime = GREATEST(vclock, now_epoch) + (est_cost / plan_weight)
vclock     = fair_vtime
```

Cost by class: agent 10.0, long 5.0, short 1.0, system 0.0 (operational work
never charges a tenant).

`GREATEST(vclock, now_epoch)` is the part that matters most and is easiest to
miss. Without it a tenant who flooded an hour ago and went quiet still carries a
clock far in the future and stays starved long after their burst ended. Clamping
to `now` means an idle tenant always re-enters at the front.

`placeAndAdvance` is a single `UPDATE … RETURNING`, so two concurrent triggers for
the same workspace cannot both read the same clock. It never throws: a scheduling
hint must not be able to fail a trigger, so on error it falls back to `now`,
degrading that one run to FIFO.

## 5. Wakeup — and the failure that is silent

Hybrid: `LISTEN run_queued` on a dedicated connection, plus a 2s safety poll.

**PgBouncer transaction pooling breaks LISTEN.** Registrations are dropped
silently; notifications simply never arrive. The system keeps working on the
fallback poll and looks event-driven from the outside, so nobody finds out until
someone asks why claim latency is 2 seconds. `ClaimWakeup` therefore:

- resolves `DATABASE_DIRECT_URL` first, falling back to `DATABASE_URL`;
- logs at **ERROR**, not WARN, if the URL matches `-pooler.`, `pgbouncer` or
  `:6432`;
- exposes `claim_wakeup_total{source}` so `notify` near zero while `safety_poll`
  climbs is visible on a dashboard.

**Neon compute hours.** The listener connection is idle except when a
notification arrives — it issues no queries and holds no transaction. The 2s
safety poll runs one `LockSupport.unpark` per consumer, not a query; the claim
itself only runs when a consumer has free permits. Idle cost is therefore one
open connection, which does not keep a Neon compute endpoint awake on its own.
Watch `claim_duration_seconds_count` after cutover: if it climbs while nothing is
queued, something is claiming on a timer and that *would* raise compute hours.

## 6. Reserved slots — the demo lane

`CLAIM_RESERVED_PRIORITY_SLOTS` (default 1) permits per pool are held open for
priority traffic at all times:

```
free  > reserved → claim anything, down to the reserve
free <= reserved → claim priority runs only
```

Stateless — no running count of who holds what — so it stays correct across
restarts and across replicas with no coordination. Each worker independently
holds N permits open; the fleet-wide reserve is the sum. Capped at half the pool,
because a reserve larger than that starves the traffic it exists to protect.

Enabling the lane for a workspace, half an hour before a demo:

```sql
INSERT INTO workspace_usage_policies (workspace_id, priority_lane)
VALUES ('<workspace-id>', true)
ON CONFLICT (workspace_id) DO UPDATE SET priority_lane = true;
```

Takes effect on the next enqueue. It does **not** re-prioritise runs already
queued — `fair_vtime` and `priority` are stamped at trigger — so flip the flag
before triggering, not after.

## 7. Queue position

`GET /api/runs/:id/queue-position` →

```json
{ "position": 4, "etaSeconds": 37, "reason": "tenant_cap",
  "message": "Waiting on your workspace's concurrency limit. Position 4, about 37 seconds." }
```

Position uses the same ordering as the claim, so it is the real answer rather than
an approximation. ETA comes from measured completions per second for that class
over the last five minutes — a model would be wrong the moment the fleet is
resized.

`reason` distinguishes **`tenant_cap`** (your own limit; your other runs are the
cause; upgrade or wait) from **`global_saturation`** (the platform is busy; not
your fault, not your fix). The UI shows these differently, and conflating them
turns "your plan's limit" into "the product is broken".

None of this is answerable from a Redis stream.

---

## 8. Migration — dual-mode cutover

Two independent flags. Deploying the code changes nothing until one is set.

| Flag | Where | Values |
|---|---|---|
| `QUEUE_MODE` | API | `redis` (default) · `dual` · `postgres` |
| `WORKER_CLAIM_MODE` | worker | `redis` (default) · `dual` · `postgres` |

**Why it is safe to run both.** The run lease is an atomic compare-and-set on a
single row. Whichever transport arrives second finds the lease held and drops the
job. The claim adds a second independent gate (`UPDATE … WHERE status IN
('queued','yielded')`), but the lease alone was already sufficient — dual mode
needs no new mechanism. Verified: 0 duplicates across 3 replicas, §1.

### Steps

Each step is independently reversible. Do not proceed while the previous step's
check is failing.

**0. Apply V023 and V024.** Additive only — new columns with defaults, new
indexes, one trigger. No existing column changes type or nullability.
*Rollback:* `DROP` the indexes and trigger; the columns are harmless if unused.

**1. Set `WORKER_CLAIM_MODE=dual` on one replica.** It now consumes streams *and*
claims from Postgres. Nothing else changes; the API still only XADDs, so the
claim finds only runs the API has committed — which is all of them.
*Check:* `claimed_total > 0` and `claim_wakeup_total{source="notify"} > 0` on that
replica. Runs still complete at the same rate.
*Rollback:* set it back to `redis`. Instant, no drain needed.

**2. Roll `WORKER_CLAIM_MODE=dual` to the whole fleet.**
*Check:* no run has two `RUN_STARTED` events —
`node scripts/load/dual-mode-check.mjs`, or in production:
```sql
SELECT run_id, count(*) FROM run_events
 WHERE type = 'RUN_STARTED' AND timestamp > now() - interval '1 hour'
 GROUP BY run_id HAVING count(*) > 1;
```
Must return zero rows.
*Rollback:* back to `redis`, fleet-wide.

**3. Set `QUEUE_MODE=dual` on the API.** Now every run is written to Postgres
with `fair_vtime`/`priority` *and* mirrored onto its typed stream. The mirror is
best-effort: the row is authoritative and already committed, so a failed XADD
costs nothing.
*Check:* `enqueued_by_class` still climbing; stream depth still draining.
*Rollback:* `QUEUE_MODE=redis`.

**4. Set `QUEUE_MODE=postgres` on the API.** The XADD stops. Streams begin to
drain and do not refill.
*Check:* `XLEN runs.short` (and long/agent/system) falling to 0 and staying there.
*Rollback:* `QUEUE_MODE=dual` — refills the streams immediately.

**5. Wait for the streams to drain.** All four at `XLEN = 0`, and every consumer
group PEL empty:
```
XINFO GROUPS runs.short   # pending must be 0
```
*Rollback:* still `QUEUE_MODE=dual`.

**6. Set `WORKER_CLAIM_MODE=postgres`.** Stream consumers are no longer created.
*Check:* `[startup] consumers ready — typed=[] legacy=disabled`; throughput
unchanged; `claim_duration_seconds` p95 under 100ms.
*Rollback:* `dual`, then `QUEUE_MODE=dual` to refill. This is the last cheap
rollback point.

**7. Delete the streams.** `DEL runs.short runs.long runs.agent runs.system
workflow-runs`. Only after step 6 has been stable for a full business day.
*Rollback:* none — but by this point nothing writes to them.

### What is deliberately still present

- `TypedStreamConsumer`, `WorkflowQueueConsumer` and `SharedTenantAdmission`
  remain in the tree. They are what `dual` and `redis` modes run on, and deleting
  them before step 7 would remove the rollback path. They are dead code only
  after every environment is at `postgres`.
- `RunProcessor` skips `admitAtClaim` for jobs whose `triggeredBy` is `pg-claim`.
  The claim already applied the identical limits atomically; re-running the check
  would be a second round trip to the same answer, and its refusal path
  re-enqueues onto a stream that claim mode does not have.

---

## 9. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `QUEUE_MODE` | `redis` | API transport: `redis`/`dual`/`postgres`. |
| `WORKER_CLAIM_MODE` | `redis` | Worker transport: `redis`/`dual`/`postgres`. |
| `DATABASE_DIRECT_URL` | `DATABASE_URL` | **Non-pooled** endpoint for LISTEN. |
| `CLAIM_SAFETY_POLL_MS` | `2000` | Fallback poll when NOTIFY is lost. |
| `CLAIM_RESERVED_PRIORITY_SLOTS` | `1` | Permits per pool held for the priority lane. |
| `CLAIM_STALE_SECONDS` | `120` | Grace for a `claimed` row without a lease; also the reclaim threshold. |

## 10. Metrics

| Metric | Reading it |
|---|---|
| `claim_duration_seconds{class}` | p95 over 100ms means the claim, not the work, is the bottleneck. |
| `claimed_total{class}` | Runs taken. Flat while runs are queued ⇒ admission is refusing everything. |
| `claim_wakeup_total{source}` | `notify` near zero + `safety_poll` climbing ⇒ LISTEN is dead. |
| `claim_reserved_lane_total{class}` | Flat at zero ⇒ the reserve is never used and could be released. Climbing steadily ⇒ the pool is undersized and the demo lane is masking it. |
| `claim_reclaimed_total` | Rows recovered from a dead worker. Non-zero after a deploy is normal; a steady trickle is not. |
