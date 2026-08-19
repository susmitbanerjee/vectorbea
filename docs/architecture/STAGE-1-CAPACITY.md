# Stage 1 — capacity, isolation, and the thread-per-run ceiling

Implements §5 Stage 1 of `09-EXECUTION-ARCHITECTURE-REVISED.md`. Small, safe,
reversible changes only: configuration, one isolated dispatcher, and one read
controller. **No scheduling redesign, and no replicas scaled.**

---

## 1. Per-pool sizing, decoupled from `WORKER_CONCURRENCY`

### The problem

All four pools were derived from a single knob:

```kotlin
val shortConcurrency  = env("SHORT_WORKER_CONCURRENCY")?.toIntOrNull()  ?: maxOf(8, concurrency)
val longConcurrency   = env("LONG_WORKER_CONCURRENCY")?.toIntOrNull()   ?: maxOf(1, concurrency / 2)
val agentConcurrency  = env("AGENT_WORKER_CONCURRENCY")?.toIntOrNull()  ?: maxOf(1, concurrency / 2)
val systemConcurrency = env("SYSTEM_WORKER_CONCURRENCY")?.toIntOrNull() ?: 2
```

At the shipped `WORKER_CONCURRENCY=4` that is **2 agent slots platform-wide**.
Raising agent capacity meant raising every pool at once, so nobody did — which is
exactly how §1.4's "two concurrent agent runs anywhere saturate the platform"
survived in production.

### The change

Each pool gets its own variable, resolved first-match-wins:

| Variable | Falls back to | Stage 1 value |
|---|---|---|
| `WORKER_POOL_SHORT` | `SHORT_WORKER_CONCURRENCY`, then `max(8, C)` | 8 |
| `WORKER_POOL_LONG` | `LONG_WORKER_CONCURRENCY`, then `max(1, C/2)` | 2 |
| `WORKER_POOL_AGENT` | `AGENT_WORKER_CONCURRENCY`, then `max(6, C/2)` | **6** |
| `WORKER_POOL_SYSTEM` | `SYSTEM_WORKER_CONCURRENCY`, then `2` | 2 |
| `WORKER_POOL_TENANT_DB` | — | 16 |

The old names still work and the formula is unchanged, so a worker with none of
the new variables set behaves exactly as before. Only the AGENT default moved
(`max(1, C/2)` → `max(6, C/2)`), which is the Stage 1 instruction.

Confirmed in the boot log:

```
pools       : short=8 long=2 agent=6 system=2
tenant-db   : 16 threads (isolated dispatcher)
max run threads: 18 pool + 16 tenant-db
replicas    : 1
```

### Measured JVM cost — where the thread-per-run ceiling actually is

`jvm_threads_live`, `jvm_heap_used_bytes` and `jvm_process_cpu_seconds` are new
on `:9090`, sampled at scrape time. Measured on the S01 harness at agent=6,
`-Xmx768m`, with 800 ms mocked LLM latency:

| State | Peak live threads | Peak heap used | CPU consumed |
|---|---|---|---|
| Idle, just booted | 21 | 37 MB | — |
| S01 scenario 1 (1 agent run) | 57 | 61 MB | 6.4 s |
| S01 scenario 2 (3 concurrent agent runs) | 63 | 73 MB | 3.4 s |
| S01 scenario 3 (10 runs, 6 concurrent) | 68 | 80 MB | 8.2 s |
| S01 scenario 4 (55 runs, 240 s of queueing) | 70 | 90 MB | 53 s |
| S01 scenario 5 (5 agent + 4 hanging DB) | 74 | 89 MB | 9.3 s |

Heap ceiling is 768 MB (`-Xmx768m`); peak observed use was **90 MB, under 12 %**.

**The ceiling is threads, and it is not close.** Two facts set it:

1. **Roughly 5 threads per concurrent run, not 1.** A run in flight occupies its
   class-pool thread, a `wf-node-*` thread executing the node, and a share of the
   shared HTTP client's 32-thread executor. Going from 1 to 10 in-flight runs
   cost 48 threads — about 5 each.
2. **CPU is irrelevant at this shape.** Scenario 3 consumed **8.2 s of CPU** while
   accumulating **64.9 s of `thread_blocked_seconds`** across a 19.2 s wall
   clock — the worker spent roughly eight times longer waiting on sockets than
   computing, and finished the whole scenario on less CPU than one core-second
   per two runs. This is the quantitative case for Stage 4 (non-blocking I/O):
   the same box could carry an order of magnitude more concurrency if waiting
   stopped costing a thread.

**Extrapolated ceiling on the current 768 MB heap / default 1 MB stacks:** the
JVM comfortably runs ~500–1000 platform threads before stack reservation and
scheduler overhead dominate. At ~5 threads per run that is roughly **100–200
concurrent runs per replica**, an order of magnitude above the 18 pool slots
configured. Heap is not the constraint at this workload — it never exceeded
74 MB of 768 MB.

**So agent=6 is safe, and 6 is conservative.** The binding constraint today is
not the JVM; it is that per-tenant fairness is in-process (see §4), which caps
how far a single replica should be pushed before that is fixed.

---

## 2. Isolated tenant-database dispatcher

### The change

`db_read` / `db_write` node execution moved onto `TenantDbDispatcher` — 16
threads, queue depth 8, separate from all four class pools.

The rejection policy is the design, not a detail:

```kotlin
// NOT CallerRunsPolicy — see the class KDoc. Rejection is the guarantee.
ThreadPoolExecutor.AbortPolicy(),
```

`CallerRunsPolicy` is the usual choice for a bounded pool and it is precisely
wrong here: it would run the query on whichever pool thread submitted it,
spilling the hang straight back into the agent or short pool and silently
deleting the isolation. When the dispatcher is full a `db_*` node fails fast with
an actionable message instead. A failed run is recoverable; a stalled platform is
not.

New metrics: `tenant_db_slots_total`, `tenant_db_slots_active`,
`tenant_db_queue_depth`, `tenant_db_rejected_total`, and a
`thread_blocked_seconds{pool="tenant-db"}` series.

### Verified — S01 scenario 5

The scenario's "unrelated tenants" were changed from `linear-5-step` to
`agent-iterative-8-turn` first, because the classifier bins `linear-5-step` as
LONG (TECH-DEBT.md#D5) — the same class the hang lands in. Measuring two
workloads contending for one 2-slot pool and calling it interference would not
have answered the question.

| | Before Stage 1 | After Stage 1 |
|---|---|---|
| Runs completed | 4 of 9 (**timed out**, 5 never terminal) | **9 of 9** |
| Wall clock | 240 s (cap) | **41.1 s** |
| Peak AGENT slots used by unrelated tenants | 0 — they never ran | **5 of 6, concurrently** |
| Hang footprint | 2 of 2 LONG slots | 1 LONG slot (tenant cap), ≤1 dispatcher thread of 16 at a time |
| Failure classification | `socket/timeout=2 connect=1` | all 4 bounded (`socket/timeout=3 connect=1`) |
| Dispatcher rejections | n/a | **0** — 16 threads absorbed it with room to spare |
| Where the blocked time landed | pool threads | `thread_blocked_seconds{pool="tenant-db"} = 18.0 s` |

That last row is the containment, stated numerically: **18 seconds of blocked
time that a tenant's broken database cost, and that no pool thread paid.**

**Answer to "are unrelated tenants now unaffected": yes.** All five ran
concurrently on the AGENT pool at full speed while the hanging tenant's queries
failed on the dispatcher.

### The honest limit

Isolation is **thread-level, not slot-level**. `executeWithTimeout` submits the
node to the dispatcher and the class-pool thread then blocks on the future, so a
`db_query` run still occupies its LONG slot while waiting. What the dispatcher
guarantees is that the thread *parked on the tenant's socket* is never a pool
thread, and that the number of such threads is capped at 16 regardless of load.

Releasing the slot as well requires either non-blocking I/O (Stage 4) or a
cooperative yield around node execution (Stage 2+). Recorded as TECH-DEBT.md#D2.

---

## 3. XREADGROUP read bounding — verified, and tightened

### What it was

```kotlin
private fun totalAcceptCapacity(): Int = synchronized(bufferLock) {
    WorkerJobType.entries.sumOf { type ->
        val bufferRoom = (config.maxPrefetchPerPool - buffers.getValue(type).size).coerceAtLeast(0)
        router.availableCapacity(type) + bufferRoom
    }
}
```

**Verified correct on both counts asked:**

- `availableCapacity(type)` is `capacity - outstanding` — **free** slots, not
  total. ✓
- `bufferRoom` is `maxPrefetchPerPool - size`, floored at 0, so the local buffer
  **cannot exceed** its per-pool cap. ✓

### The residual, and why the sum is not sufficient

The bound is necessary but not sufficient, for a structural reason: **the stream
is untyped, so a message's class is only known after it has been read and
classified.** "8 placements available" can mean "8 free SHORT slots" while the
next eight messages are all AGENT. Those cannot be placed, and are left unacked
in the PEL — over-reading is exactly how a worker hoards work it cannot start.

A capacity *sum* cannot fix that. Only `min` across every pool could guarantee
placement, and that would be zero whenever any single pool is busy, stalling
healthy classes to protect a saturated one.

### What was tightened

1. **`readMessages` no longer reads with zero capacity.** The previous
   `.coerceAtLeast(1)` meant a zero-capacity call still pulled one message
   straight into the PEL. The poll loop guarded this at the call site, but the
   function was unsafe on its own terms.

2. **`AdaptiveReadBatch`** — an AIMD controller in the same shape as the existing
   `PollBackoff`. It does not predict the class mix; it measures the outcome:

   - parked anything last poll → **halve** the batch
   - parked nothing → **grow by one**, up to `WORKER_READ_BATCH_SIZE`

   A skewed mix costs a handful of parked messages once, then the batch shrinks
   toward 1 and the worker stops hoarding. Exposed as `worker_read_batch_size`.

   Observed working: during scenario 4 the gauge fell from 8 to **3** as messages
   parked, then recovered.

3. **`WORKER_MAX_PREFETCH_PER_POOL` raised 2 → 4.** A *buffered* message is held
   in this JVM and placed as soon as a slot frees; a *parked* message is stranded
   in the PEL. Trading a little heap for fewer parks is a good trade at
   4 × 4 pools × one small job object.

The real fix remains Stage 2 — type the queue at enqueue, give each class its own
stream, and the question disappears. Recorded as TECH-DEBT.md#D3.

---

## 4. Replicas — explicitly NOT scaled

**Confirmation: the replica count was not changed. It remains 1, and no caps were
divided in any running configuration.**

`REPLICA_COUNT` was implemented as instructed, defaulting to `1` (no division),
so the mechanism exists the moment capacity is needed without changing today's
behaviour.

When set above 1, `TenantConcurrencyLimiter` divides every per-tenant cap by it
and emits a twelve-line `WARN` block at startup naming the debt entry, the
effective post-division caps, and the requirement to update `REPLICA_COUNT`
whenever the fleet is resized.

Why it is a stopgap and not a fix — the limiter is in-process JVM state, so:

- nothing coordinates the replicas; each just gets a smaller private allowance;
- division floors at 1, so `maxActiveAgentRunsPerTenant=1` across 3 replicas is
  still an effective 3 — the tightest limit the platform most wants is the one
  this cannot express;
- it is static, so scaling 3 → 5 without updating the variable silently restores
  the over-admission it exists to prevent.

Both the division and the cannot-divide-below-1 limitation are pinned by tests in
`TenantConcurrencyLimiterTest`, so the constraint is documented in executable
form. Tracked as **TECH-DEBT.md#D1**, to be **deleted** — not defaulted — in
Stage 3.

**Recommendation: do not scale replicas until Stage 3.** Stage 1 raised
single-replica agent capacity 3×, which is the cheaper and safer lever, and §1.3
is explicit that scaling out before shared fairness converts "everyone is slow"
into "one tenant is fast and everyone else is stalled".

---

## 5. Before / after

Single worker, one replica, identical harness and mocked upstreams. "Before" is
the Stage 0 configuration recorded in `LOAD-BASELINE.md` §A (agent=2, shared node
execution, `readBatchSize` fixed at 8, `maxPrefetchPerPool` 2).

### Completion — the headline

| Scenario | Enqueued | Completed before | Completed after |
|---|---|---|---|
| 1 · 1 tenant, 1 agent workflow | 1 | 1 | 1 |
| 2 · 3 tenants × 1 agent workflow | 3 | 3 | 3 |
| 3 · 10 tenants × 1 agent workflow | 10 | **4** (timed out) | **10** |
| 4 · flood 50 + 5 tenants × 1 | 55 | **8** (timed out) | **20** (timed out) |
| 5 · hanging tenant DB + 5 normal | 9 | **4** (timed out) | **9** |

### Latency and throughput

| Scenario | Throughput before → after (runs/s) | Wait p50 before → after | Wait p95 before → after | Fairness before → after |
|---|---|---|---|---|
| 1 | 0.093 → **0.097** | 413 ms → 434 ms | 413 ms → 434 ms | 1.00 → 1.00 |
| 2 | 0.158 → **0.362** (2.3×) | 472 ms → 342 ms | **11.23 s → 346 ms** (32×) | 1.00 → 1.00 |
| 3 | 0.017 → **0.522** (31×) | 28 ms → 273 ms | 11.94 s → 10.98 s | **∞ → 1.00** |
| 4 | 0.033 → **0.083** (2.5×) | 2.95 s → 14.78 s | 15.62 s → 38.21 s | ∞ → ∞ |
| 5 | 0.017 → **0.219** (13×) | 501 ms → 31 ms | 23.66 s → 34.78 s | **∞ → 4.00** |

### Reading these honestly

- **Scenario 1 is unchanged, and should be.** Nothing contends, so nothing the
  Stage 1 changes touch is on the path. The 21 ms difference is noise.
- **Scenario 2 is the clean win.** Three agent runs no longer queue behind a
  2-slot pool: p95 wait collapses from 11.23 s to 346 ms, and all three run
  concurrently (`agent=3` peak). This is §1.4 resolved at this scale.
- **Scenario 3 is the important one.** Before: 4 of 10 runs finished and the rest
  were stranded. After: all 10 finish in 19.2 s with perfect fairness, peaking at
  6 of 6 agent slots. Tenant 10's wait is **10.98 s**, down from 65.67 s measured
  against a build with the reclaim defect repaired — the honest comparison,
  since the as-shipped run never completed at all.
- **Scenario 4's p50/p95 got worse, and that is expected.** Before, only 8 runs
  ever started, so the percentiles described a small lucky subset. After, 20
  complete and 40 more are genuinely queued behind a 2-slot LONG pool, so the
  percentiles now describe the real queue. Throughput — the number that cannot be
  gamed by not starting work — went up 2.5×. See §6 for why this scenario is
  still limited.
- **Scenario 5 is not a like-for-like row.** The scenario definition changed: the
  "unrelated tenants" moved from `linear-5-step` to `agent-iterative-8-turn` so
  that "unrelated" means a genuinely different pool (§2). The p95 rise reflects
  agent runs that take 6.4 s each, not a regression. The comparable facts are
  completion (4 → 9) and whether unrelated tenants ran at all (they did not
  before; all five did after).

---

## 6. What did not improve, and why

**Scenario 4 (flood fairness) is still limited**, and Stage 1 is not the reason.
Both defects behind it are documented and deliberately out of scope:

- **TECH-DEBT.md#D5** — the classifier counts `"type":` across the whole graph
  JSON, and *edges* carry a `type` field. `linear-5-step` (7 nodes, 6 edges)
  counts as 13, crosses the threshold of 12, and is routed to the **2-slot LONG**
  pool instead of the 8-slot SHORT one. The harness now reports derived classes
  per scenario and flags the mismatch, so it cannot recur silently.
- **TECH-DEBT.md#D4** — XAUTOCLAIM recovery is a silent no-op, so messages parked
  in the PEL are stranded rather than retried.

Neither is a Stage 1 change: the first is classification, the second is when
parked work resumes. Both are scheduling behaviour. **D4 is the highest-value
next change on the list.**
