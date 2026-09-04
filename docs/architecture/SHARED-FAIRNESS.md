# Shared-state fairness, and scaling to 3 replicas

Implements §2.2 of `09-EXECUTION-ARCHITECTURE-REVISED.md`: move per-tenant
admission from JVM memory onto `run_leases`, then scale out safely.

---

## 1. The bug being fixed

`TenantConcurrencyLimiter` counted a workspace's active runs in a local
`ConcurrentHashMap` of semaphores. Correct at one replica, wrong at every other
number: three replicas each enforced "max 1 agent run" independently, so one
workspace got three. Scaling out — the thing the architecture review recommends —
was itself what broke fairness.

The shared registry already existed. `run_leases` holds one row per actively
executing run with `workspace_id` and `expires_at`, is authoritative across the
cluster, and is self-healing: a worker that dies stops renewing and its leases
drop out of the count on their own. It simply was not consulted at admission.

---

## 2. What was built

| | Before | After |
|---|---|---|
| Admission state | in-process semaphores | `run_leases` count query |
| Limits | 4 global env constants | per-workspace `workspace_usage_policies` rows |
| Correct at N replicas | **no** — limits × N | **yes** |
| Hot-path cost | none | none — cached, refreshed asynchronously |
| Hard enforcement point | — | at lease claim |

### The index, and a correction to the design doc

§2.2 proposes:

```sql
CREATE INDEX run_leases_tenant_active_idx
  ON run_leases (workspace_id, expires_at) WHERE expires_at > now();
```

**That statement cannot execute.** Postgres requires index predicates to be
IMMUTABLE and `now()` is STABLE; it fails with *"functions in index predicate
must be marked IMMUTABLE"*. V009 hit the same thing and left a comment about it.

V021 creates the plain composite index instead. It serves the admission query
identically — the planner seeks on `workspace_id` and range-scans `expires_at` —
and the only thing given up is not indexing already-expired leases, which the
recovery sweep deletes anyway.

### Two layers, and why both are needed

**Layer 1 — advisory cache, on the poll path.** Admission reads a cached
`run_leases` count with a 300 ms staleness window, refreshed in the background.
No admission decision waits on Postgres.

**Layer 2 — hard gate, at the lease claim.** Immediately after a run acquires its
lease, the worker counts leases for that workspace that are *older* than its own
and refuses if they already fill the quota.

The second layer is not belt-and-braces. It is the enforcement, and the reason is
measured rather than assumed — see §3.

Ordering is what makes layer 2 livelock-free. Two replicas that both insert and
then both count "3 > 2" would both back off, leaving the tenant under-served.
Counting only *older* leases, by `(created_at, run_id)`, gives a total order: the
first N acquirers always win, every later one yields, and no coordination is
needed.

A refused run releases its lease, is re-enqueued to the tail of its own class
stream, and stays `queued`. Nothing is lost.

---

## 3. Three iterations, because the first two were wrong

Worth recording, because the failures are more instructive than the final design.

### Attempt 1 — advisory cache only

The design as specified: cache the count, refresh asynchronously, treat it as
advisory.

| N | Peak per-tenant concurrency |
|---|---|
| 1 | 2 |
| 2 | **4** |
| 3 | **6** |

Exactly 2×N — **the original bug, faithfully reproduced through a cache.**

The cause is that every replica starts with a cold cache, reads zero, admits a
full quota against its own in-flight counter, and only learns about the others
when the async refresh lands. A 300 ms window against ~1 s runs is never in front
of the work. The prompt's own framing — *"the lease acquire is still the hard
gate"* — is only true if something actually checks at that gate. Nothing did.

### Attempt 2 — add the claim-time gate

Limits held. Throughput collapsed:

| N | Completed | Throughput |
|---|---|---|
| 1 | 55/55 | 0.955 runs/s |
| 2 | **43/55** | 0.195 runs/s |
| 3 | **29/55** | 0.131 runs/s |

A refused claim left its message unacked. With typed streams a worker only reads
what it can start, so nothing re-read that message until the XAUTOCLAIM idle
threshold — **60 seconds per refusal.** Limits were correct and the platform
crawled.

### Attempt 3 — the two fixes that made it work

1. **Read the cold miss synchronously.** One query per workspace per process, so
   a replica never begins by believing a busy workspace is idle.
2. **Re-enqueue on refusal instead of parking.** A fresh `XADD` to the tail of the
   run's own class stream, retried in seconds rather than a minute.

---

## 4. Results

### The headline assertion — per-tenant limits hold constant

S01 test 4 (one tenant floods 50 short runs, five tenants submit 1 each),
`max_concurrent_runs = 2`:

| Replicas | Runs completed | Peak per-tenant concurrency | Overshoot |
|---|---|---|---|
| **1** | 55/55 | **2** | 0 |
| **2** | 55/55 | **2** | 0 |
| **3** | 55/55 | **2** | 5 |

**Identical at every replica count.** Measured from `run_leases` joined to runs in
`status = 'running'` — the shared state itself, not any worker's bookkeeping, so
the number is independent of how many workers exist or what their local counters
say.

The `status = 'running'` filter matters and is not a convenience: a run refused
by the claim gate holds its lease for the few milliseconds of the check before
releasing it. Counting bare leases catches those transients and reports
concurrency the platform never granted. The same transient is why the overshoot
counter reads 5 at N=3 while actual executing concurrency stayed at 2 — a
non-zero overshoot reading with the claim gate active means "a claim was
inspected and refused", not "policy was violated".

### Throughput scaling

S01 test 4 is the wrong workload for this question, and its numbers say so:

| Replicas | Throughput (test 4) |
|---|---|
| 1 | 0.972 runs/s |
| 2 | 0.849 runs/s |
| 3 | 0.712 runs/s |

**This is correct behaviour, not a regression.** 50 of the 55 runs belong to one
workspace capped at 2 concurrent. That cap is the binding constraint at every
replica count, so extra replicas add no parallelism — only coordination. A
workload defined by one tenant hitting its limit *cannot* scale with replicas,
and it would be a fairness bug if it did.

S01 test 3 (10 tenants × 1 agent run — capacity-bound rather than policy-bound):

| Replicas | Wall clock | Throughput | Peak per-tenant |
|---|---|---|---|
| 1 | 18.7 s | 0.535 runs/s | 1 |
| 2 | **11.7 s** | **0.852 runs/s** (1.6×) | 1 |
| 3 | 13.2 s | 0.758 runs/s | 1 |

Scaling is real but saturates at N=2, and the reason is arithmetic: the workload
is 10 runs, each tenant capped at 1 agent run, so maximum useful concurrency is
10 — already covered by two replicas' 12 agent slots. N=3 adds claim coordination
against parallelism that does not exist to be won.

**Scaling is bounded by offered concurrency, not by replica count.** To
demonstrate linear scaling one needs a workload with more independent tenants
than one replica's slots.

### Correctness under 3 replicas

| Check | Result |
|---|---|
| Duplicate execution | **0 runs with more than one `RUN_STARTED`** |
| Work distribution | executed across multiple replicas, not pinned to one |
| Lease contention | resolves cleanly — the loser skips, no retry storm, no stuck runs |
| Runs completed | 55/55 and 10/10, no timeouts |
| Every replica registered | 3 rows in `workers`, all beating |

---

## 5. The stopgap is gone

`REPLICA_COUNT` and its cap division are deleted: the config field, the
twelve-line startup warning, and `TenantConcurrencyLimiter` itself. Limits are
now correct at any replica count without being told how many there are, which is
the entire point — the stopgap's worst property was that it silently reverted to
over-admission whenever the fleet was resized without updating the variable.

`TECH-DEBT.md#D1` is closed.

---

## 6. Fleet visibility

`GET /api/status` returns liveness, load and headroom per worker, plus a fleet
roll-up.

Getting there required fixing something first. §6.5 calls the `workers` table
"unused telemetry"; it was worse than unused. **V006 made
`workers.workspace_id NOT NULL`** as part of a workspace-scoping pass, while
`WorkerHeartbeat`'s UPSERT never supplied the column — so from V006 onward *every
heartbeat write failed*, silently, because the failure is caught and logged at
WARN and the loop continues. A worker is fleet infrastructure and has no
workspace to name at boot. V021 restores the column to nullable.

Verified with 3 replicas running:

```
workers=3 live=3 stale=0 capacity=54 active=0 headroom=54
```

Two details worth noting:

- **Liveness is derived from heartbeat age, not the worker's self-reported
  `status`.** A crashed worker cannot update its own status; the last thing a
  dead worker says is "idle". Healthy ≤ 45 s (three missed beats at a 15 s
  interval), stale > 120 s.
- **Capacity counts live workers only.** A stale worker's slots are not headroom —
  nothing will schedule onto them — and including them would report a fleet as
  healthy precisely while it was losing workers.
- **`capacity` is now the real pool total (18 = 8+2+6+2)**, not the legacy
  `WORKER_CONCURRENCY` knob (4), which has not described real capacity since pool
  sizing was decoupled.

---

## 7. Graceful drain

On SIGTERM the worker now releases its leases explicitly instead of letting them
expire. Without it, a rolling deploy leaves each replica's in-flight leases to
time out over the full 60 s TTL, during which those runs are invisible to crash
recovery *and* still counted against their workspace's limit — a tenant held at
its cap for a minute after its work stopped.

**Verified partially, and here is exactly what was and was not covered.** The SQL
scoping is confirmed against the harness database: with leases held by
`load-worker-1` and `load-worker-2`, releasing the first deletes only its own row
and leaves the other intact.

The SIGTERM-triggered path itself could **not** be exercised on this machine.
Windows has no SIGTERM for a windowless JVM — `taskkill` without `/F` does not
deliver a close event the JVM handles, and `/F` skips shutdown hooks entirely. On
Linux, which is what Railway runs, SIGTERM runs JVM shutdown hooks normally. This
should be confirmed on the first staging deploy by looking for:

```
[shutdown] released N run lease(s) — capacity freed immediately, not on expiry
```

---

## 8. Deployment

Railway replica count is a dashboard setting and was **not** changed from here —
scaling was verified locally with three processes. To apply:

1. Deploy the worker and API with V021 applied.
2. Confirm `GET /api/status` shows the expected worker count.
3. Raise Railway replicas 1 → 2. Confirm `/api/status` shows 2 live, and that
   `tenant_admission_overshoot` stays flat.
4. Raise 2 → 3. Same checks.

`REPLICA_COUNT` no longer exists, so nothing needs updating when the count
changes — which was the point.

### What to watch

| Signal | Meaning |
|---|---|
| `tenant_claim_rejected_total` | claim-gate refusals. A steady low rate is the design working; a climbing rate means the advisory cache is too stale — lower `TENANT_LOAD_STALENESS_MS` |
| `tenant_admission_overshoot_total` | with the claim gate active, mostly counts refused-claim transients rather than real violations. Cross-check against executing concurrency before acting |
| `tenant_load_query_seconds` | cost of the shared count. Should stay sub-millisecond on the new index |
| `GET /api/status` → `stale` | workers that stopped beating |

---

## 9. Remaining limitation

Admission is enforced at the claim, which is *after* the lease insert. The window
between insert and check is real but sub-millisecond, and the ordering rule makes
its outcome deterministic rather than racy. §3 of the architecture doc's S06
end-state folds the check into the claim itself — a single `INSERT … WHERE
(SELECT count(*) …) < limit` — which removes the window and the release path
together. That is a scheduler change, not a fairness change, and belongs there.
