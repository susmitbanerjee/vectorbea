# Typed Queue — design, migration, rollback

Implements §2.1 of `09-EXECUTION-ARCHITECTURE-REVISED.md`: classify before
enqueue, route to per-class streams.

---

## 1. What was wrong

A stream message carried `{runId, jobType}` and nothing about execution class, so
the worker had to `XREADGROUP` first and probe Postgres afterwards to learn what
it had taken. If a batch turned out to be agent-heavy while the agent pool was
full, those messages sat in **that worker's** Pending Entries List, where no
other worker could reach them until the idle threshold expired.

Head-of-line blocking had not been fixed by the pool split. It had relocated —
from the thread pool up into the stream, where it was less visible and could not
be solved by adding capacity.

Measured, on one worker, with 12 agent runs saturating the agent pool and 8 short
runs behind them:

```
peak PEL by stream: workflow-runs=20
wait[short]: p50=5.97s  p95=72.69s  max=72.69s
```

All twenty messages held by a single worker, and short runs — which had eight
free slots waiting for them the entire time — queued behind agent work for over a
minute.

---

## 2. What replaced it

| | Before | After |
|---|---|---|
| Streams | 1 (`workflow-runs`) | 4 (`runs.short`, `runs.long`, `runs.agent`, `runs.system`) |
| Consumer groups | 1 | 1 per stream |
| Classification | after the claim, per job, by the worker | before the enqueue, per **workflow version**, by the API |
| `XREADGROUP COUNT` | free slots summed across all pools | that pool's free slots |
| Can a worker hold work it cannot run? | yes | **no** |

`agent_runs.execution_class` is the materialised answer, written at trigger.
`workflow_versions.execution_class` memoises the classification permanently — a
version's graph is immutable, so its class is too.

### Classification rules

| Class | Rule |
|---|---|
| `agent` | any `llm` or `agent` node — decided outright, an LLM call is the longest blocking operation the worker performs |
| `long` | any `http` / `db_*` / `tool` node, **or** ≥12 nodes, **or** a `parallel` node with ≥4 outgoing branches |
| `short` | everything else — and the fallback whenever a graph cannot be parsed |
| `system` | timers, recovery, continuations — synthesized by the worker |

`GraphClassifier` **parses** the graph rather than substring-matching it. The
worker's old classifier approximated node count by counting `"type":`
occurrences across the raw JSON, and edges carry a `type` field too, so a
7-node / 6-edge workflow counted as 13, crossed the threshold of 12, and was
routed to the 2-slot LONG pool instead of the 8-slot SHORT one — mis-binning
essentially every workflow above about six nodes. That was TECH-DEBT.md#D5; it is
closed by this change.

### Where each job's class comes from

| Path | Source |
|---|---|
| Fresh trigger, replay, debug run, scheduled run | classified from the workflow **version** |
| RESUME_RUN after a yield | `agent_runs.execution_class` — **read, never re-derived** |
| Approval resume, manual recover | `agent_runs.execution_class` |
| continue-as-new | inherited from the run being continued (same version) |
| Timer / crash recovery | SYSTEM, placed straight onto the local pool |

A continuation must land in the pool its first half occupied. Re-deriving would
reintroduce the probe this change exists to delete, and would let a run that
started on `runs.agent` resume on `runs.short`.

### Durability contract — unchanged

1. `agent_runs` committed, `status='queued'`
2. `XADD`
3. `enqueue_failed` if the XADD throws
4. `XACK` **last**, only after a durable terminal state

A crash between 1 and 2 leaves a `queued` row with no message, which crash
recovery finds. The reverse — a message with no row — remains impossible.

---

## 3. Results

Same worker binary, same scenario, one variable: which stream the runs were
enqueued on (`LOAD_USE_LEGACY_STREAM`).

### Scenario 6 — saturated agent pool + short runs

| | Untyped | Typed | |
|---|---|---|---|
| **short-run wait p50** | **5.97 s** | **0.07 s** | **85× better** |
| **short-run wait p95** | **72.69 s** | **0.10 s** | **727× better** |
| agent-run wait p50 | 23.54 s | 17.27 s | |
| Wall clock | 87.7 s | 44.9 s | 2.0× |
| Throughput | 0.228 runs/s | 0.445 runs/s | 2.0× |
| Peak PEL | `workflow-runs=20` | `runs.agent=6`, `runs.short=8` | |
| Peak short slots used | **0 of 8** | **8 of 8** | |

The last row is the finding. Under the untyped stream the short pool sat
completely idle — eight free slots — while short runs waited over a minute,
because the messages were stuck behind agent work in one worker's PEL and,
separately, were mis-binned to the 2-slot LONG pool by the old classifier.

Both causes are consequences of classifying after the claim, and both are gone.

### PEL depth — the guarantee, verified

The typed-queue promise is that peak PEL depth per stream never exceeds that
pool's slot count.

| S01 test | Pool slots | Peak PEL (untyped) | Peak PEL (typed) |
|---|---|---|---|
| 2 · 3 agent tenants | agent 6 | 3 | `runs.agent=3` |
| 3 · 10 agent tenants | agent 6 | 10 | **`runs.agent=6`** |
| 4 · flood 55 | short 8 | 41 | **`runs.short=8`** |
| 5 · hanging DB | agent 6, long 2 | 21 | **`runs.agent=5`, `runs.long=2`** |
| 6 · mixed | agent 6, short 8 | 20 | **`runs.agent=6`, `runs.short=8`** |

**Never exceeded, in any run.** Every typed stream's peak PEL depth landed exactly
at — never above — its pool's slot count. And the streams for idle classes stayed
at exactly `0` throughout: `runs.short=0` and `runs.long=0` during the all-agent
tests, `runs.agent=0` during the all-short flood.

That is the guarantee stated as a measurement: a worker cannot hold a message it
has no slot to run.

### Full S01 suite — Stage 1 vs typed

| Scenario | Completed | Throughput (runs/s) | Wait p95 | Peak PEL |
|---|---|---|---|---|
| 1 · baseline | 1/1 → 1/1 | 0.097 → 0.122 | 434 ms → 358 ms | 1 → `agent=1` |
| 2 · 3 agent tenants | 3/3 → 3/3 | 0.362 → 0.364 | 346 ms → 388 ms | 3 → `agent=3` |
| 3 · 10 agent tenants | 10/10 → 10/10 | 0.522 → **0.584** | 10.98 s → **8.74 s** | 10 → **`agent=6`** |
| 4 · flood 50 + 5×1 | **20/55 → 55/55** | 0.083 → **1.125** | 38.21 s → 42.48 s | 41 → **`short=8`** |
| 5 · hanging DB + 5 | 9/9 → 9/9 | 0.219 → **0.301** | 34.78 s → 23.39 s | 21 → `agent=5, long=2` |
| 6 · agent + short | — → 20/20 | — → 0.453 | — | **`agent=6, short=8`** |

Tests 2 and 3 are all-agent, so there is nothing for typing to decouple *from* —
their modest gains come from dropping the per-job classifier probe.

**Scenario 4 is the surprise**, and it is a classification result rather than a
routing one. It had never completed: 20 of 55 runs in 240 s. It now finishes all
55 in **48.9 s — 13.5× the throughput** — because `GraphClassifier` correctly bins
`linear-5-step` as SHORT and it runs on the 8-slot short pool instead of the
2-slot LONG pool the edge-counting bug had been sending it to.

Its fairness ratio reads 50.00, which needs reading carefully: **every tenant
completed every run it submitted.** The ratio is best-served ÷ worst-served by
completed count, and one tenant deliberately submitted 50× more work than the
others. Perfect service, unequal demand — the metric measures the demand.

**Scenario 5 improved for the same reason.** The unrelated agent tenants now wait
**0.02 s p50** (was 23.31 s) because they are on `runs.agent` while the hanging
database occupies `runs.long`. Stage 1 had them contending for one pool.

---

## 4. Migration — zero downtime

Two independent switches, so no step requires both services to move together:

- **API:** `REDIS_LEGACY_QUEUE_STREAM` — when set, mirror every enqueue onto the
  old stream as well.
- **Worker:** `WORKER_LEGACY_STREAM_ENABLED` — when true (default), keep a
  consumer on the old stream.

Both default to the safe, dual-running position.

### Step 1 — Migrate the schema

```bash
# V020: adds both columns with defaults, plus the partial index, and backfills
# pending runs. Nothing reads the columns yet.
```

**Safe because:** both columns have defaults, so every existing INSERT keeps
working, and no deployed code reads them.
**Rollback:** `ALTER TABLE agent_runs DROP COLUMN execution_class;` and the same
for `workflow_versions`. No code depends on them at this point.

### Step 2 — Deploy the worker (dual-consume)

```
WORKER_LEGACY_STREAM_ENABLED=true    # default
```

The worker now consumes all four typed streams **and** the legacy stream. The
typed streams are empty, so it behaves exactly as before.

**Safe because:** the API is still writing only to `workflow-runs`, which the
worker still serves. Typed consumers idle harmlessly.
**Rollback:** redeploy the previous worker image. Typed streams are empty, so
nothing is stranded.

### Step 3 — Deploy the API (typed writes + legacy mirror)

```
REDIS_LEGACY_QUEUE_STREAM=workflow-runs
```

Every enqueue now goes to its typed stream **and** is mirrored to the legacy one.

**Safe because:** a worker on either version sees every job. The typed write is
authoritative and happens first; the mirror is best-effort and cannot fail a
trigger that already succeeded. A job executed from both streams is prevented by
the existing run-lease CAS — the second claim finds the run no longer `queued`
and drops.
**Rollback:** redeploy the previous API. Workers keep consuming the legacy stream
they were already serving.

### Step 4 — Stop mirroring

Once every worker instance is on the new version:

```
# remove REDIS_LEGACY_QUEUE_STREAM
```

**Verify first:**

```bash
redis-cli XLEN workflow-runs
redis-cli XPENDING workflow-runs workflow-workers
```

Both must be draining, and `XPENDING` must reach zero.
**Rollback:** set the variable again. It is a single env change, no deploy.

### Step 5 — Drain, then verify for 24 h

```bash
# Must be 0, and must stay 0
redis-cli XLEN workflow-runs
redis-cli XPENDING workflow-runs workflow-workers
```

A non-zero `XPENDING` after `XLEN` reaches zero means a worker holds messages it
never acked — investigate before continuing. Do not skip the 24 h window: it is
what catches a low-frequency producer (a nightly schedule, a rarely used
integration) still writing to the legacy stream.

**Rollback:** nothing to roll back; this step only observes.

### Step 6 — Remove the legacy consumer

```
WORKER_LEGACY_STREAM_ENABLED=false
```

**Safe because:** the stream has been empty for 24 h.
**Rollback:** set it back to `true` and redeploy. The legacy consumer resumes and
picks up anything that arrived meanwhile.

### Step 7 — Clean up

After a further week of clean operation:

```bash
redis-cli DEL workflow-runs
```

and delete `WorkflowQueueConsumer`, `JobClassifier`, and
`RedisStreamsWorkflowQueue` from the codebase.

**Point of no return.** Everything before this is reversible by env var or
redeploy; this step is not. Do it only once `XLEN workflow-runs` has been zero for
a week and no code path references the legacy classes.

### Backfill for existing queued runs

V020 backfills `execution_class` for runs in `queued` / `yielded`, using a cruder
heuristic than the API classifier — it exists so in-flight work lands in a
sensible pool during the deploy, not to be authoritative. Terminal runs are left
at the `'short'` default because a terminal run is never re-enqueued and its class
is decoration.

To reclassify everything properly afterwards (optional, off the hot path):

```sql
UPDATE workflow_versions SET execution_class = NULL;  -- forces re-derivation
```

Each version is then re-classified by the API on its next trigger.

---

## 5. What to watch during the migration

| Signal | Meaning |
|---|---|
| `api_runs_enqueued_by_class_total` | producer side — should show all four classes in use |
| `worker_pel_depth{stream}` | must never exceed that pool's `worker_pool_slots_total` |
| `worker_pel_depth{stream="workflow-runs"}` | should fall to 0 and stay there after step 4 |
| `job_wait_before_start_seconds{class}` | short-class p95 should be near-zero regardless of agent load |
| `xautoclaim_reclaim_total` | now actually increments — see below |

### Also fixed here: XAUTOCLAIM

`TECH-DEBT.md#D4` — `redis.xautoclaim(...)` returns `ClaimedMessages` on Lettuce
6.3.2, not `List<StreamMessage>`. The old code cast it with
`as? List<…> ?: return`, which evaluated to null on every sweep and returned
silently: no exception, no log, no metric, and pending recovery had never once
run.

Fixed in both the typed consumers and the legacy one. Typed streams make parking
rare — a message is only claimed when a slot exists — but this path still matters
for what it was written for: recovering work from a worker that died mid-flight.
