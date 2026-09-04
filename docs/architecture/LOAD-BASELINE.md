# Load Baseline

> **Superseded for current numbers.** This document records the **Stage 0**
> baseline — agent pool 2, shared node execution, fixed read batch. Stage 1
> changes (per-pool sizing, isolated tenant-DB dispatcher, adaptive read
> bounding) and the before/after comparison are in
> [`STAGE-1-CAPACITY.md`](STAGE-1-CAPACITY.md). Keep this file: it is the
> reference point every later measurement is compared against.

Measured against `scripts/load/`, on a single worker with production-derived
pool sizes. Reproduce with:

```bash
docker compose -f scripts/load/docker-compose.load.yml up -d
node scripts/load/migrate.mjs
node scripts/load/mock-upstreams.mjs --port 18080 &
node scripts/load/hang-db.mjs --port 15433 &
scripts/load/start-worker.sh &
node scripts/load/run.mjs --all --out docs/architecture/LOAD-BASELINE.md
```

## Configuration under test

| | |
|---|---|
| Worker | 1 replica, `WORKER_CONCURRENCY=4` |
| Pools | short **8**, long **2**, agent **2**, system **2** |
| Tenant caps | total **2**, agent **1**, long **1**, short **4** |
| Prefetch | `readBatchSize` 8, `maxPrefetchPerPool` 2 |
| PEL reclaim | idle 60 s, sweep 30 s |
| Mock latency | LLM 800 ms/call, tool 100 ms, slow-tool 30 s |
| Timeouts | connect 5 s, socket 30 s, HTTP total ceiling 120 s |

`agent-iterative-8-turn` = 8 sequential LLM calls ≈ **6.4 s of blocking I/O per
run**, holding one agent slot throughout. That is the unit most numbers below are
best read in.

---

## A. As shipped

This is today's behaviour, including the XAUTOCLAIM defect documented in
`TIMEOUT-AUDIT.md` §13. Scenarios 3–5 hit the 240 s harness timeout.

| # | Scenario | Tenants | Enqueued | Completed | Throughput (runs/s) | Wait p50 | Wait p95 | Wait p99 | Fairness | Peak PEL |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 tenant, 1 agent workflow | 1 | 1 | 1 | 0.093 | 413 ms | 413 ms | 413 ms | 1.00 | 1 |
| 2 | 3 tenants × 1 agent workflow | 3 | 3 | 3 | 0.158 | 472 ms | 11.23 s | 11.23 s | 1.00 | 3 |
| 3 | 10 tenants × 1 agent workflow | 10 | 10 | **4** | 0.017 | 28 ms | 11.94 s | 11.94 s | **∞** | 10 |
| 4 | 1 tenant floods 50 + 5 tenants × 1 | 6 | 55 | **8** | 0.033 | 2.95 s | 15.62 s | 15.62 s | **∞** | 57 |
| 5 | hanging tenant DB + 5 normal | 6 | 9 | **4** | 0.017 | 501 ms | 23.66 s | 23.66 s | **∞** | 62 |

**Scenarios 3, 4 and 5 did not finish.** 6, 47 and 5 runs respectively never
reached a terminal state within 240 s, with **every pool idle**. That signature —
`worker_pel_depth > 0` while `worker_pool_slots_active == 0` everywhere — is the
XAUTOCLAIM defect: messages parked in this worker's PEL are never reclaimed, so
the work is neither running nor recoverable. `xautoclaim_reclaim_total` stayed at
`0` throughout.

The fairness ratios of `∞` in this table therefore measure that defect, not the
scheduler.

---

## B. With the XAUTOCLAIM defect repaired

Same worker, same configuration, with the one-line fix
(`redis.xautoclaim(...).messages`) applied to a **throwaway build only** — the
committed code is unchanged, per the brief's "do not change scheduling
behaviour". These are the numbers the scenarios were designed to produce.

| # | Scenario | Tenants | Enqueued | Completed | Throughput (runs/s) | Wait p50 | Wait p95 | Wait p99 | Fairness | Peak PEL |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 tenant, 1 agent workflow | 1 | 1 | 1 | 0.093 | 413 ms | 413 ms | 413 ms | 1.00 | 1 |
| 2 | 3 tenants × 1 agent workflow | 3 | 3 | 3 | 0.158 | 472 ms | 11.23 s | 11.23 s | 1.00 | 3 |
| 3 | 10 tenants × 1 agent workflow | 10 | 10 | **10** | 0.136 | 23.60 s | **65.67 s** | 65.67 s | 1.00 | 10 |
| 4 | 1 tenant floods 50 + 5 tenants × 1 | 6 | 55 | 34 | 0.141 | 88.20 s | 230.92 s | 237.98 s | **∞** | 51 |
| 5 | hanging tenant DB + 5 normal | 6 | 9 | **9** | 0.177 | 23.31 s | 44.20 s | 44.20 s | 4.00 | 21 |

---

## Scenario notes

### 1 — Baseline

Wait before start **413 ms**: poll latency plus one classifier probe. The run held
one agent slot for its whole life and `thread_blocked_seconds{pool="node"}` rose
by **6.6 s** — 8 × 800 ms, exactly the mocked LLM time. Nothing is wasted and
nothing is contended; this is the ceiling.

### 2 — Saturation at 2 slots, as predicted

`worker_pool_slots_active{pool="agent"}` pinned at **2** for the duration.
p50 stayed at 472 ms (the two runs that got slots immediately) while p95/p99 rose
to **11.23 s** — the third tenant waiting out most of a full agent run.
`thread_blocked_seconds` rose **18.7 s** ≈ 3 × 6.4 s.

This is §1.4 of the execution architecture reproduced exactly: *two concurrent
agent runs anywhere on the platform saturate it*.

### 3 — Tenant 10's wait

**65.7 s.** With ten agent runs against two slots, the last-served tenant waits
roughly five agent-run durations, and the measured p95 (65.67 s) is within ~2 %
of the 5 × 6.4 s ≈ 64 s the model predicts. Fairness was **1.00** — every tenant
completed exactly one run, so the queue is fair; it is simply five times too
small.

Total blocked time was **64.3 s** against a 73.3 s wall clock: the worker spent
88 % of the scenario with threads parked on sockets. Adding CPU would change
nothing.

### 4 — Fairness under flood: the tenant limiter works, the pool is too small

**344 throttle events** on the flooding workspace, and `tenant_active_runs` never
exceeded its cap — the per-tenant limiter did its job. But a quiet tenant still
completed **nothing** in 240 s, hence fairness `∞`.

The cause is not the limiter. It is that `linear-5-step` derived as **LONG**, not
SHORT (see *Classifier finding* below), so 55 runs contended for **2** slots
instead of 8, and `maxActiveRunsPerTenant=2` let the flooder hold both of them
for long stretches. Admission fairness without a *reserved* share for small
tenants still starves them.

### 5 — The critical test: does a hanging tenant DB degrade unrelated tenants?

**Yes — but boundedly, and only now.**

| Question | Answer |
|---|---|
| How many slots does it consume? | **2 of 2** — the entire LONG pool |
| For how long? | **30 s per query**, then the slot is returned |
| Total monopolisation | 4 queries ÷ 2 slots × 30 s ≈ **60 s** |
| Did unrelated tenants complete? | **Yes, all 5** |
| What did they pay? | p50 **23.3 s**, max **44.2 s** wait before start |
| Failure classification | `socket/timeout=4` — every hung query terminated at its bound |

The `fairness 4.00` figure is an artifact of unequal submission (tenant 1 sent 4
runs, the others 1 each), not of unfair service.

**Before the timeout fixes, this scenario had no end state.** The two LONG slots
would have been held indefinitely, and each hung query would additionally have
leaked one `wf-node-*` thread permanently (`TIMEOUT-AUDIT.md` §7). The five
unrelated tenants would never have completed.

Two distinct bounds fire here, and both were previously absent:

- **`loginTimeout` (5 s)** when the pool opens its first connection — measured at
  7.4 s end to end by `verify-timeouts.mjs`.
- **`socketTimeout` (30 s)** for a query on an already-established connection.

Residual risk worth stating plainly: the isolation is *pool-level*, not
tenant-level. A hanging tenant still occupies shared LONG slots for up to
`socketTimeout` per query. Lowering `DB_SOCKET_TIMEOUT_SECONDS` shrinks the
blast radius linearly; per-tenant slot reservation removes it.

---

## Targeted regression checks

`node scripts/load/verify-timeouts.mjs` — the two shapes that previously had no
end state:

```
1. HTTP tool whose upstream sends headers then stalls the body
  ✓ tool-stall: failed after 16.3s (expected failure between 10s and 45s)
      reason: HTTP request for node 'n1' exceeded its 15000ms budget and was aborted.

2. Tenant database that accepts TCP and never responds
  ✓ tenant-db-hang: failed after 7.4s (expected failure between 3s and 60s)
      reason: cannot create DB pool: Cannot create pool for connection 'Hanging tenant DB' …

PASS — both calls are bounded.
```

`tool-stall` is the important one. The mock returns `200 OK` and a partial body,
then holds the socket open forever. `HttpRequest.timeout()` is already satisfied
at that point; only the total-call ceiling ends it.

---

## Classifier finding

`linear-5-step` — 7 nodes, 6 edges — is declared `expectedClass: SHORT` but the
classifier derives **LONG**. `JobClassifier.classifyGraph` approximates node
count as:

```kotlin
val nodeCount = TYPE_KEY.findAll(g).count()   // Regex("\"type\"\\s*:")
```

over the whole graph JSON. **Edges carry a `type` field too**, so 7 nodes + 6
edges = 13 matches, over the threshold of 12, and a small workflow is routed to
the 2-slot LONG pool instead of the 8-slot SHORT one.

This materially changed scenario 4: the "short runs" flood never touched the
SHORT pool. Any workflow with more than ~6 nodes is likely mis-binned today.

The harness now reports the derived class per scenario and flags mismatches
against the shape's `expectedClass`, so this cannot silently recur. Not fixed
here — it is scheduling behaviour, and §2.1 of
`09-EXECUTION-ARCHITECTURE-REVISED.md` proposes deleting this probe entirely by
materialising `execution_class` at enqueue time.

---

## A note on the histogram cross-check

Each scenario reports `job_wait_before_start_seconds` p95 from the worker's own
histogram alongside the exact figure. They diverge — scenario 3 reads 65.67 s
exact against ~90 s bucketed — because the metric's buckets are 30/60/120/300 s
at that end of the range, and `histogram_quantile` interpolates linearly inside
whichever bucket the target lands in.

This is not a defect; it is the resolution the bucket layout buys, and a Grafana
panel would show the same number. Exact percentiles come from `run_events`; the
histogram is retained as the alertable signal. If wait-before-start becomes an
SLO, add buckets between 10 s and 120 s.

---

## What to alert on

| Signal | Meaning |
|---|---|
| `worker_pel_depth > 0` while all `worker_pool_slots_active == 0` | XAUTOCLAIM defect — work is stranded, not queued |
| `thread_blocked_seconds` rate ÷ interval ≈ `worker_pool_slots_total` | the pool is waiting on I/O, not computing; more CPU will not help |
| `tenant_db_call_duration_seconds{outcome="socket_timeout"}` rising | a tenant database is a black hole; each event is one slot held for the full timeout |
| `llm_call_duration_seconds{outcome="timeout"}` rising | a provider is stalling bodies, not just responding slowly |
| `tenant_throttled_total` high with low throughput | admission control is working but the pool behind it is too small |
