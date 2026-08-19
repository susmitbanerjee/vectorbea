# Vectorbea — Execution Architecture, Revised
### Based on the actual schema and worker implementation · No infra changes

---

## 0. Corrections to my earlier assessment

Document `05-BACKEND-ARCHITECTURE.md` was written before I had your schema or worker internals. Three of its assumptions were wrong, and I'd rather retract them than let you spend time on non-problems.

| Earlier claim | Reality | Status |
|---|---|---|
| "Dual-write between Postgres and Redis silently stalls runs" | You already commit `agent_runs` + `run_events` **before** `XADD`, and flip to `enqueue_failed` when the enqueue throws | **Retracted.** Already solved. |
| "Suspension probably holds a worker slot" | `workflow_timers` is DB-backed with `fire_at`; `TimerScheduler` polls Postgres; cooperative yield checkpoints and releases the thread | **Retracted.** Already correct. |
| "You need to build idempotency and fencing from scratch" | `run_leases` with `lease_token`, `ON CONFLICT … WHERE expires_at < now()`, CAS on every transition, XACK-last, `step_executions.idempotency_key` | **Mostly built.** Fencing needs one gap closed (§6.3). |

What survives from that document: the fairness argument, the connection-pool trap, and the queue-position/admission-control work. What replaces it is below.

**The honest summary: your durability engineering is good. Your scheduling is the problem, and it is a narrower problem than "not enough concurrency."**

---

## 1. The actual diagnosis

### 1.1 The one-sentence version

> **Work is pulled into a worker process before the system knows whether that process can run it.**

Every symptom you're seeing descends from that single design property.

### 1.2 The chain

```
Redis stream `workflow-runs` is UNTYPED
   └─ a message carries {runId, jobType} — nothing about execution class
        └─ so the worker must XREADGROUP first, then probe Postgres
           (JobClassifier: SELECT graph_json) to learn what it just took
              └─ if the batch turns out to be agent-heavy and the agent pool
                 (2 slots) is full, those messages sit in THIS worker's PEL
                    └─ no other worker can take them — Redis Streams PEL is
                       owned by the consumer until idle-timeout + XAUTOCLAIM
                          └─ head-of-line blocking has moved from the thread
                             pool up into the stream itself
```

The `ExecutionPoolRouter` fixed head-of-line blocking *inside* a process. The blocking relocated to the layer above, where it is less visible and harder to fix by adding capacity.

### 1.3 Why "just run N replicas" doesn't fix it — and introduces a bug

Your architecture review concludes: *"The fix already exists in the architecture, just isn't turned on… Running N replicas gives N independent workerIds reading from the same group."*

That is true for throughput. It is **wrong for fairness**, and the reason is in your own sequence diagram:

> `TenantConcurrencyLimiter + ExecutionPoolRouter are in-process JVM state — no Redis/DB calls`

**Per-tenant limits are enforced per process, so N replicas multiply every limit by N.**

| Limit | N=1 | N=3 | N=5 |
|---|---|---|---|
| `maxActiveAgentRunsPerTenant` = 1 | 1 | **3** | **5** |
| `maxActiveRunsPerTenant` = 2 | 2 | **6** | **10** |
| `maxActiveShortRunsPerTenant` = 4 | 4 | **12** | **20** |

The moment you scale out to solve capacity, one noisy tenant can consume N× their allowance — and the PEL hoarding from §1.2 means they can do it while holding messages other workers can't reach. You would scale from *"everyone is slow"* to *"one tenant is fast and everyone else is stalled,"* which is worse and much harder to diagnose.

**Do not scale replicas until fairness lives in shared state.** §5 sequences this correctly.

### 1.4 What "one blocked node exhausts the platform" actually means

The precise mechanism, from `WorkerConfig.kt:109-117`:

```
agent pool = max(1, WORKER_CONCURRENCY / 2) = 2 slots, platform-wide
```

Two concurrent agent runs *anywhere on the platform* saturate it. Not two per tenant — two total. An iterative agent with `max_iterations: 10` and a 6-second LLM call per iteration holds one of those two slots for a minute. Two such runs and every other tenant's agent work parks in the PEL.

And the slot is held by a **JVM thread blocked on an HTTP socket.** During those 60 seconds the thread does nothing but wait. That is the capacity you are paying Railway for.

Your cooperative yield helps *between* nodes. It does nothing *within* a node — and an LLM call is a single node.

### 1.5 The three blocking sources

| Source | Typical block | Worst case | Notes |
|---|---|---|---|
| LLM provider call | 2–30s | 60s+ | The dominant cost |
| HTTP tool call | 0.1–30s | `tools.timeout_ms` | |
| **Tenant database** via `ClientDbPoolManager` | 5ms–? | **unbounded** | The dangerous one |

That third row deserves attention. `db_read`/`db_write` nodes open JDBC connections to *the tenant's own database*. If a tenant's Postgres is unreachable or hanging, the JDBC call blocks the thread. And a Kotlin `withTimeout` around a blocking JDBC call **does not cancel it** — it abandons the coroutine while the thread stays blocked on the socket, forever if no socket timeout is configured.

**Verify this before anything else:** every JDBC connection to a tenant database must set `connectTimeout`, `socketTimeout`, and `loginTimeout` at the driver level. Without those, one tenant with a firewalled database can permanently consume slots — and your `failure_incidents.category` will report a timeout that never actually fired.

---

## 2. The fix: decide before you pull

The scheduler should answer *"what may this worker run right now?"* **before** any message leaves the queue. That requires two things you already almost have.

### 2.1 Type the queue at enqueue time

The API already knows `workflow_version_id` when it triggers a run, therefore it knows `graph_json`, therefore it can classify. Classification after the claim is pure loss.

Add `execution_class` to `agent_runs`, computed once at trigger, cached per `workflow_version_id`:

```
short   no agent nodes, no long tools        → fast, high throughput
long    long-running tools, big fan-out
agent   any AI Agent / LLM node              → the scarce resource
system  timers, recovery, continuations
```

Then publish to **four streams** — `runs.short`, `runs.long`, `runs.agent`, `runs.system` — with one consumer group each. Each worker pool consumes only its own stream and reads only as many messages as it has free slots.

PEL hoarding disappears by construction: a worker can never hold a message it isn't able to run.

This is a small change with a large effect, and it needs no new infrastructure.

### 2.2 The fairness state you already have

Here is the thing that makes this cheap: **`run_leases` is already the shared active-work registry.** Every running run holds a lease row with `workspace_id` and `expires_at`. You are simply not consulting it at admission time.

```sql
SELECT workspace_id, count(*) AS active
FROM run_leases
WHERE expires_at > now()
GROUP BY workspace_id;
```

That is authoritative, cluster-wide, per-tenant active concurrency — already correct, already crash-safe (an expired lease drops out automatically), already indexed by run. Move `TenantConcurrencyLimiter` from JVM memory onto this query and per-tenant limits become correct at any replica count.

Add one index:

```sql
CREATE INDEX run_leases_tenant_active_idx
  ON run_leases (workspace_id, expires_at)
  WHERE expires_at > now();
```

### 2.3 Make waiting free

The single largest capacity multiplier available to you, and it needs no new services.

Convert the three blocking sources to suspending calls:

| Call | From | To |
|---|---|---|
| LLM provider | blocking HTTP client | Ktor client with coroutine engine, suspending |
| HTTP tool | blocking | suspending, per-host connection cap |
| Tenant DB | blocking JDBC | keep JDBC, but run on a **bounded** dedicated dispatcher with hard socket timeouts |

Tenant DB access should stay on its own small dispatcher (say 16 threads) rather than the general pool. A hanging tenant database then exhausts *that* dispatcher, not your agent capacity. Blast radius contained to the tenant who caused it — which is also exactly what your Connections UI already promises to show.

With suspending I/O, a pool "slot" stops meaning "a thread" and starts meaning "a permit." One replica moves from ~14 concurrent to **150–300**.

### 2.4 Where this lands

| | Today | After §2.1–2.3, N=1 | N=3 |
|---|---|---|---|
| Total concurrent | 14 | ~200 | ~600 |
| Agent concurrent | **2** | ~80 | ~240 |
| Per-tenant caps | correct at N=1 only | correct | correct |
| PEL hoarding | yes | no | no |
| One slow tenant DB | consumes agent slots | consumes only its dispatcher | same |

No new infrastructure. Same Railway, same Neon, same Upstash.

---

## 3. The scheduler end-state (stage 4, not now)

Once §2 is in, there's an optional simplification worth taking: **let Postgres make the claim decision and demote Redis to a wakeup signal.**

You are already doing a Postgres claim — `RunLeaseManager.acquire` is the real mutual-exclusion primitive. Redis Streams is, functionally, a notification layer that also happens to hoard messages. Replacing the `XREADGROUP` claim with a `SKIP LOCKED` claim removes a whole class of problems rather than adding machinery:

```sql
WITH tenant_load AS (
  SELECT workspace_id, count(*) AS active
  FROM run_leases WHERE expires_at > now()
  GROUP BY workspace_id
),
claimable AS (
  SELECT r.id
  FROM agent_runs r
  JOIN workspace_usage_policies p ON p.workspace_id = r.workspace_id
  LEFT JOIN tenant_load tl ON tl.workspace_id = r.workspace_id
  WHERE r.status IN ('queued', 'yielded')
    AND r.execution_class = :class
    AND COALESCE(tl.active, 0) < p.max_concurrent_runs
  ORDER BY r.priority DESC, r.fair_vtime
  FOR UPDATE OF r SKIP LOCKED
  LIMIT :batch
)
UPDATE agent_runs r
SET status = 'claimed', claimed_by = :workerId, claimed_at = now()
FROM claimable c WHERE r.id = c.id
RETURNING r.*;
```

What this buys that Redis Streams cannot:

- **Priority lanes** — the demo lane you need before an investor call is `priority DESC`
- **Weighted fairness** — `fair_vtime` (§3.1) interleaves tenants instead of FIFO
- **Class routing** — one indexed predicate
- **Queue position** — `count(*) WHERE fair_vtime < mine`, which is the ETA the UI promises
- **No PEL, no XAUTOCLAIM, no idle-timeout tuning**
- **One less failure mode** — Upstash eviction can no longer strand work

Redis keeps what it's genuinely good at: SSE pub/sub fan-out, the 24h idempotency cache, read-through caching, rate limiting.

### 3.1 Weighted fair ordering

At enqueue:

```
fair_vtime = GREATEST(workspace.vclock, now_epoch) + (est_cost / plan_weight)
workspace.vclock = fair_vtime
```

A tenant submitting 500 runs pushes their own clock far forward; a tenant submitting one gets a vtime near now and is served next. Weighted fairness from a single indexed column, no round-robin bookkeeping.

Store `vclock` on `workspaces` or `workspace_usage_policies`.

---

## 4. Schema gaps against the UI promises

I went through the ERD against the interfaces designed in P01–P21. Most of it is there — `workflow_node_debug_snapshots` in particular is exactly what the I/O mapping inspector (P16) needs, and `failure_incidents` with `retryable` / `auto_replay_safe` / `remediation_json` is precisely the Recovery Engine card (P12). Six gaps matter.

### 4.1 The Checkpoint Ribbon will N+1 your Runs page

The Ribbon renders per-node commit state inline on every row. The Runs page shows 163 rows. Naively that is 163 queries against `run_checkpoints` + `step_executions`.

**Add a denormalised summary, maintained by the worker on each node transition:**

```sql
ALTER TABLE agent_runs
  ADD COLUMN node_total      integer,
  ADD COLUMN node_committed  integer NOT NULL DEFAULT 0,
  ADD COLUMN ribbon_json     jsonb   NOT NULL DEFAULT '[]';
  -- ribbon_json: [{n:"n1001",s:"committed",ms:284},{n:"n1002",s:"failed"}]
```

One column read renders the Ribbon at every scale, and `node_committed / node_total` gives you *"8 of 12 committed — retry costs 4 steps"* without a join. Cap `ribbon_json` at ~200 entries; beyond that the Ribbon collapses to segments anyway.

### 4.2 `_sanitized` breaks the replay promise

Nearly every payload column carries the `_sanitized` suffix — `run_events.output_json_sanitized`, `step_outputs.raw_output_json_sanitized`, `agent_decisions.decision_json_sanitized`.

If sanitisation is lossy, **replay cannot be byte-identical**, and both your landing page ("Replay any run") and your builder inspector ("Replay: Replay available") overstate what the system does.

Resolve it explicitly, one of three ways:

1. **Sanitisation is reversible/lossless** (masking references, not deletion) → document it, keep the promise.
2. **Sanitisation is lossy** → add an unsanitised store with short retention (7d) and workspace-scoped encryption, used only by replay. Beyond retention, replay degrades to "structural replay" and the UI says so.
3. **Accept the limitation** → rename the feature to *"Inspect"* and reserve *"Replay"* for what genuinely reproduces.

Any of the three is fine. Silently promising the first while implementing the second is not.

### 4.3 Two approval tables

`approvals` (run_id, step_id, agent_id, risk_level, payload_json_sanitized, decided_by) and `run_approvals` (run_id, node_id, status, metadata_json, resolved_by) overlap almost entirely. Two writers, two readers, and the Approvals UI won't know which is authoritative.

Pick one — `run_approvals` has the cleaner shape and `node_id` matches the rest of the graph vocabulary — migrate, and drop the other. Add what P13 needs: `sla_deadline_at`, `escalation_policy_json`, `decision_context_json` (resolved values, not templates), `confidence_score`.

### 4.4 No audit log

Your architecture doc lists `AuditLog` as a Prisma-managed table. **It is not in the ERD.** Your docs promise "a full audit trail" under Governance, and P20 designs the screen. Enterprise buyers ask about this on the first call.

```sql
CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  environment_id uuid,
  actor_type text NOT NULL,        -- user | system | api_key
  actor_id text,
  action text NOT NULL,            -- workflow.publish, approval.decide, …
  target_type text NOT NULL,
  target_id uuid,
  before_json jsonb,
  after_json jsonb,
  ip_hash text,
  user_agent text,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Append-only. No update or delete path in the application layer at all.

### 4.5 No queue visibility

Nothing supports *"you're #47, about 3 minutes"* — which P10 and P11 both promise, and which is the difference between a user trusting a slow system and a user assuming it's broken.

Add `priority` and `fair_vtime` to `agent_runs` (§3.1), then queue position is one indexed count. Expose `GET /api/runs/:id/queue-position` and a workspace-level `GET /api/status`.

### 4.6 `run_events` will become your largest table

Full input/output JSONB per event, on the write path for every step and the read path for every run detail view. You've clearly anticipated growth (`history_size_bytes`, `continue_as_new_recommended`, `run_continuations`), which is good — but add:

- **Monthly partitioning** on `created_at`, with detach-and-drop retention driven by `workspace_usage_policies.log_retention_days`
- **Payload offload** above ~256KB to object storage, storing a reference
- A covering index for the timeline query: `(run_id, sequence)`

---

## 5. Sequencing

Ordered by risk-adjusted value. Stage 1 is same-day.

### Stage 1 — Today (config + one audit, ~2 hours)

1. **Verify socket timeouts** on every outbound path, especially tenant JDBC. This is a correctness bug hunt, not a feature.
2. Raise `WORKER_CONCURRENCY` so the agent pool goes from 2 → 6. Cheap, immediate.
3. **Do not scale replicas yet.** If you must today, divide every per-tenant cap by the replica count as a stopgap and note it as debt.

### Stage 2 — Week 1: Type the queue (~8h)
`execution_class` on `agent_runs`, computed at trigger. Four streams, four consumer groups. Pools read only their own class, bounded by free slots. **Kills PEL hoarding.**

### Stage 3 — Week 2: Shared fairness, then scale (~10h)
Move `TenantConcurrencyLimiter` onto the `run_leases` query. Add the partial index. **Then** scale Railway to 2–3 replicas — safely, with correct limits.

### Stage 4 — Week 3: Non-blocking I/O (~12h)
Suspending LLM and HTTP clients. Tenant JDBC onto a bounded dedicated dispatcher with hard socket timeouts. Per-host connection caps. **~10× capacity per replica.**

### Stage 5 — Week 4: Postgres-claim scheduler (~14h)
Replace the `XREADGROUP` claim with `SKIP LOCKED` + fairness + priority. Redis → wakeup, cache, pub/sub. Unlocks priority lanes, the demo lane, and queue position.

### Stage 6 — Week 5: Close the UI gaps (~12h)
`ribbon_json` summary, replay-fidelity decision, approvals reconciliation, `audit_log`, queue-position API, `run_events` partitioning.

**Total ~58 hours.** Stages 1–3 are the floor before onboarding anyone. Stage 4 is what makes the numbers demo-worthy.

---

## 6. Robustness items worth fixing regardless

### 6.1 The classifier probe is on the hot path
`JobClassifier` does `SELECT graph_json` after every stream read, cached by `workflow_version_id`. Once `execution_class` is materialised at enqueue (§2.1), that probe disappears entirely — one fewer query per job and one fewer failure mode.

### 6.2 Crash recovery vs. lease expiry are the same mechanism
`CrashRecoveryLoop` polls stale `run_leases`; `XAUTOCLAIM` reclaims stale PEL entries. Two recovery paths for one condition means they can disagree — a run whose lease expired but whose message is still owned, or vice versa. After stage 5, only the lease sweep remains. Until then, ensure the lease TTL is comfortably shorter than the XAUTOCLAIM idle threshold so the DB always detects first.

### 6.3 Fencing is nearly complete
You have `lease_token` and CAS on status. Extend the token to **every write a leased worker performs** — `step_outputs`, `run_events`, `agent_iterations`, `run_checkpoints` — not just the status transitions. A worker whose lease was reclaimed mid-flight can currently still append events for a run it no longer owns. Zero rows affected must mean "abandon, do not retry, do not write anywhere else."

### 6.4 Continue-as-new is a real asset
`run_continuations`, `continuation_sequence`, `continue_as_new_required` — you've implemented Temporal's history-truncation pattern. That is genuinely sophisticated and almost nobody in your competitive set has it. **Surface it in the UI.** The run detail should show the continuation chain as one logical run; the Ribbon should span continuations. Right now the Runs page treats a continued run as two unrelated rows.

### 6.5 The `workers` table is unused telemetry
`workers` has `capacity`, `active_tasks`, `last_heartbeat_at`. Once you scale replicas, this becomes the fleet view for the Control page (P10) — worker liveness, per-worker load, capacity headroom. Wire the heartbeat writes into an API endpoint and the Control page gets real fleet health rather than a static tile.

---

## 7. What to tell users while the queue is deep

This is a software concern, not an infra one, and it directly protects the reviews you're worried about.

- **Queue position and ETA on every queued run.** A visible position is patience; an unexplained `queued` is a bug report.
- **Admission control with an honest error.** *"Workspace limit: 8 concurrent runs. 3 queued, ~2 min."* — not a 503.
- **Distinguish "queued" from "stalled" in the UI.** A run queued behind your own workload reads differently from a run stuck on a failed connection. The status vocabulary should say which.
- **Demo lane before the first investor call.** A `priority` column and one flagged workspace. Roughly an hour of work at stage 5, and it removes the possibility of a stranger's load test derailing a live demo.
