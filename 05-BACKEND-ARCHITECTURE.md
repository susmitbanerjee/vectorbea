# Vectorbea — Backend Architecture & Infrastructure Plan
### Fixing concurrency, fairness and durability on a ₹6k/month budget

---

## 1. Diagnosis

### 1.1 What you reported

> "Redis worker remains at 4, means only 1 workflow can be executed at a time. If I have a workflow with 4 parallel nodes, other users' workflows will be in queue."

### 1.2 What is actually wrong

Three separate problems wearing one costume.

**Problem A — concurrency is set for CPU-bound work, but your work is I/O-bound.**

A step in your engine spends its life waiting. An LLM call blocks 2–30 seconds. An HTTP tool call blocks 100ms–30s. A Postgres query blocks 5–50ms. During all of that, the worker consumes essentially no CPU.

Setting concurrency to 4 makes sense if each job pins a core. It makes no sense for suspended I/O. You are paying for a box that sits ~98% idle while runs queue behind it.

Kotlin coroutines exist for exactly this shape of work. Suspended coroutines are not threads — they cost a few KB of heap, not an OS thread. A 3-vCPU / 4GB instance should comfortably hold **200–400 in-flight steps.**

**Problem B — one global queue with one global slot pool means one tenant can starve everyone.**

This is head-of-line blocking, and it is the problem that will actually embarrass you in front of investors. Raising concurrency from 4 to 400 without fixing this just means one user can now consume 400 slots instead of 4. During a stress test, that is precisely what will happen.

You need **fair scheduling**: a per-workspace in-flight cap, plus a claim order that rotates across workspaces rather than pure FIFO.

**Problem C — I suspect waiting costs you a slot.**

Check this in your worker before anything else. If a `wait` node or a `Human Approval` gate holds a worker slot while it waits, then a single 3-day approval permanently consumes capacity. With 4 slots, four pending approvals deadlock your entire platform.

In a durable execution engine, **waiting must cost zero slots.** A suspended run is a database row with a `wake_at` timestamp or an event subscription — not a held thread, not a held coroutine, not a held anything.

Your own marketing says "a 3-day approval picks up exactly where it left off." Make sure the implementation agrees.

### 1.3 The hazard nobody reported, which will bite you hardest

**You have a dual-write problem between Postgres and Redis.**

Right now, completing a node means: write state to Postgres, then enqueue the next node to Redis. Those are two systems and there is no transaction spanning them.

- Postgres commits, process dies before Redis enqueue → **the run stalls forever.** No error, no failure, no retry. It just sits there. During a stress test this manifests as "some runs mysteriously never finish," which is the single worst bug class to debug live.
- Redis enqueues, Postgres transaction rolls back → **a step executes twice**, with real side effects. Your product sends emails and writes to databases. Double-firing is a customer-visible incident.

For a product whose entire value proposition is *"failure is a checkpoint, not a restart,"* a queue that can silently lose work is an existential correctness bug, not a performance nit.

**The fix is to put the queue in Postgres.** Then "node completed" and "next nodes enqueued" happen in one transaction, and the failure mode disappears by construction.

---

## 2. Target architecture

### 2.1 The core separation

The single most valuable structural change: **stop treating all work as one kind of work.**

| Plane | What it does | Duration | Concurrency shape | Pool |
|---|---|---|---|---|
| **Decide** | Node completed → what's next? Evaluate branches, resolve inputs, write checkpoint, enqueue successors | 1–20ms | CPU + short DB txn | Small (8–16) |
| **Execute** | Call the LLM, hit the HTTP endpoint, run the query | 100ms–60s | Pure I/O wait | Large (200–400) |
| **Suspend** | Wait until timestamp, wait for approval, wait for webhook | seconds–days | **Zero** — not resident | None |

Today all three almost certainly share one pool of 4. That's why a parallel fan-out starves the platform.

```
                        ┌──────────────────────────────┐
   Trigger              │      Postgres (Neon)         │
   (schedule/webhook/   │                              │
    manual/API)  ──────▶│  job          (the queue)    │
                        │  run, node_run               │
                        │  event        (event source) │
   ┌────────────────────│  checkpoint                  │
   │                    │  timer       (wake_at)       │
   │    LISTEN/NOTIFY   │  workspace_quota             │
   │    + 5s safety poll└──────────────────────────────┘
   │                          ▲              ▲
   │                          │              │
   ▼                          │ txn          │ txn
┌─────────────────┐     ┌─────┴────────┐  ┌──┴──────────────┐
│  Decide pool    │────▶│ Execute pool │  │  Timer sweeper  │
│  8–16 workers   │     │ 200–400      │  │  every 1s       │
│  ~5ms each      │     │ coroutines   │  │  wake_at <= now │
└─────────────────┘     └──────────────┘  └─────────────────┘
        │                      │
        │                      ├── LLM providers (BYOK, per-key rate limit)
        │                      ├── HTTP tools (per-connection cap)
        │                      └── Databases (per-connection pool)
        │
        └── large payloads ──▶ Cloudflare R2 (pointer stored in PG)
```

### 2.2 The queue moves into Postgres

`SELECT … FOR UPDATE SKIP LOCKED` is a proven queue pattern. It comfortably handles thousands of jobs/sec — two orders of magnitude beyond what you need for demo and early users.

What you gain:

- **Transactional enqueue.** Node completion and successor enqueue commit together. The stall-forever bug ceases to exist.
- **Debuggability.** Your queue becomes `SELECT * FROM job WHERE status='queued' ORDER BY …`. When something is stuck at 11pm before a demo, this matters enormously.
- **One less system in the critical path.**
- **Fairness is expressible.** You can't easily do weighted fair queuing across tenants in a Redis list. In SQL it's an ORDER BY.

What you must watch:

- Neon compute hours — solved by LISTEN/NOTIFY instead of tight polling (§2.4)
- Connection count — solved by a small pool per worker (§2.7)
- Table bloat from high-churn rows — solved by partitioning completed jobs and aggressive autovacuum on `job`

**Redis is not deleted.** It keeps the jobs it's actually good at: token-bucket rate limiting, caching, SSE fan-out for live UI updates, and short-lived distributed locks. Upstash's free tier likely covers all of that at your volume.

### 2.3 Fair scheduling

Two mechanisms, layered.

**Layer 1 — per-workspace in-flight cap.** A hard ceiling on concurrent steps per workspace, by plan tier:

```
free        8 concurrent steps
pro        40
enterprise 200
demo lane  reserved, always available   ← see §5.3
```

This alone eliminates the starvation problem. One tenant fanning out 500 parallel nodes occupies 8 slots and queues the rest — their own runs slow down, nobody else's do.

**Layer 2 — weighted fair claim order.** Rather than FIFO across all tenants, order by a virtual timestamp so tenants interleave.

At enqueue:
```
vtime = GREATEST(workspace.vclock, now()) + (estimated_cost / plan_weight)
workspace.vclock = vtime
```

Then claim with `ORDER BY vtime`. A tenant who submits 500 jobs pushes their own vclock far into the future; a tenant who submits one job gets a vtime near `now()` and is served next. Weighted fairness falls out of one indexed column, no round-robin bookkeeping.

**The claim query:**

```sql
WITH claimable AS (
  SELECT j.id
  FROM job j
  JOIN workspace_inflight wi ON wi.workspace_id = j.workspace_id
  WHERE j.status = 'queued'
    AND j.run_at <= now()
    AND wi.in_flight < wi.max_concurrent
  ORDER BY j.priority DESC, j.vtime
  FOR UPDATE OF j SKIP LOCKED
  LIMIT $batch_size
)
UPDATE job j
SET status      = 'leased',
    lease_until = now() + interval '30 seconds',
    lease_token = gen_random_uuid(),
    worker_id   = $worker_id,
    attempt     = j.attempt + 1
FROM claimable c
WHERE j.id = c.id
RETURNING j.*;
```

Claim in batches of 10–25, not one at a time. One round trip per batch instead of per job.

### 2.4 Wakeup: notify, don't poll

Tight polling keeps Neon's compute awake continuously and burns compute-hours for nothing.

**Hybrid model** (the pattern used by `graphile-worker` and `river`):

1. On enqueue, `pg_notify('job_ready', workspace_id)` inside the transaction
2. Workers `LISTEN job_ready` on a dedicated **direct** connection and claim immediately on notification
3. A 5-second safety poll catches missed notifications, timers coming due, and expired leases

Latency stays sub-100ms while idle load drops to one query per worker per 5s.

> **Gotcha:** `LISTEN/NOTIFY` does not work through PgBouncer in transaction pooling mode. The listener needs Neon's **direct** (non-pooled) connection string. Everything else uses the pooled one.

### 2.5 Suspension costs nothing

Any node that waits — `Wait`, `Human Approval`, a rate-limit backoff, a scheduled retry — must **release its slot and leave the process entirely.**

```
Node hits a wait
  └─ Write checkpoint
  └─ Set run.status = 'suspended'
  └─ INSERT timer(run_id, node_id, wake_at, reason)   -- or an event subscription
  └─ Release the slot. Nothing resident. Zero cost.

Timer sweeper (every 1s):
  SELECT ... FROM timer WHERE wake_at <= now() FOR UPDATE SKIP LOCKED
  └─ Enqueue a resume job
  └─ Run reloads from checkpoint and continues
```

A three-day approval and a three-second wait cost identically: one row. This is what makes "long-running" actually true rather than aspirational, and it's the thing that lets you claim durable execution honestly in an investor conversation.

### 2.6 Correctness under at-least-once delivery

A lease-based queue delivers **at least once**. Your product fires real side effects — emails, database writes, job applications. Three mechanisms are mandatory before you let strangers stress test.

**Fencing tokens.** When a lease expires, another worker claims the job. The original worker may still be alive and mid-flight. Every write carries its `lease_token`; the DB rejects writes from a superseded token:

```sql
UPDATE node_run SET status = 'succeeded', output = $out
WHERE id = $id AND lease_token = $token;
-- 0 rows affected → this worker was fenced. Abandon, do not retry.
```

Without this you get two workers both "completing" the same node with different outputs.

**Idempotency keys on side effects.** Every external call carries a deterministic key derived from `(run_id, node_id, attempt_group)`. Store `(idempotency_key → response)` in Postgres. On retry, if the key exists, return the stored response instead of re-calling.

This is what stops a retried `Send Email` node from emailing the customer twice. I flagged the corresponding UI in prompt P16 — the backend half lives here.

**Heartbeat and lease extension.** A step running 60s under a 30s lease will be stolen mid-flight. Long-running steps extend their lease every 10s. If a worker dies, the lease expires and the job is legitimately reclaimed.

**Poison-job protection.** A job that crashes the worker will be reclaimed and crash it again, forever. Cap `attempt`; beyond it, move to `dead_letter` with the full context and surface it in your Incidents UI (P13).

### 2.7 Connection budget

The constraint people hit first with high coroutine counts.

```
400 in-flight coroutines  ≠  400 database connections
```

| Pool | Size | Note |
|---|---|---|
| Worker → Neon (pooled) | 15–25 per instance | HikariCP. Steps hold connections for milliseconds. |
| Worker → Neon (direct) | 1 per instance | LISTEN only |
| API → Neon (pooled) | 10–20 | |
| Worker → LLM providers | 50–100 per host | **Raise this.** Ktor/OkHttp default per-host limits are ~5 and will silently serialise your calls. |
| Worker → tool HTTP | 100 total, 20 per host | Per-host cap prevents one slow endpoint from exhausting the pool |

The LLM connection-pool default is a genuinely common trap: you raise concurrency to 400, throughput barely moves, because 5 connections per host are serialising everything behind the scenes.

---

## 3. Data model changes

Additive. No rewrite.

```sql
-- The queue itself
CREATE TABLE job (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL,
  run_id         uuid NOT NULL,
  node_id        text NOT NULL,
  kind           text NOT NULL,        -- 'decide' | 'execute' | 'resume'
  status         text NOT NULL,        -- 'queued'|'leased'|'done'|'failed'|'dead'
  priority       smallint NOT NULL DEFAULT 0,
  vtime          double precision NOT NULL,
  run_at         timestamptz NOT NULL DEFAULT now(),
  lease_until    timestamptz,
  lease_token    uuid,
  worker_id      text,
  attempt        int NOT NULL DEFAULT 0,
  max_attempts   int NOT NULL DEFAULT 5,
  payload        jsonb NOT NULL,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The claim index. Partial index keeps it small under churn.
CREATE INDEX job_claim_idx ON job (priority DESC, vtime)
  WHERE status = 'queued';
CREATE INDEX job_lease_idx ON job (lease_until)
  WHERE status = 'leased';
CREATE INDEX job_run_idx ON job (run_id);

-- Fairness state
CREATE TABLE workspace_inflight (
  workspace_id   uuid PRIMARY KEY,
  in_flight      int NOT NULL DEFAULT 0,
  max_concurrent int NOT NULL DEFAULT 8,
  vclock         double precision NOT NULL DEFAULT 0
);

-- Suspension
CREATE TABLE timer (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL,
  node_id     text NOT NULL,
  wake_at     timestamptz NOT NULL,
  reason      text NOT NULL,   -- 'wait'|'retry'|'approval_sla'|'schedule'
  claimed_at  timestamptz
);
CREATE INDEX timer_wake_idx ON timer (wake_at) WHERE claimed_at IS NULL;

-- Exactly-once side effects
CREATE TABLE side_effect (
  idempotency_key text PRIMARY KEY,
  run_id          uuid NOT NULL,
  node_id         text NOT NULL,
  request_hash    text NOT NULL,
  response        jsonb,
  status          text NOT NULL,   -- 'in_flight'|'succeeded'|'failed'
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Large payload offload
ALTER TABLE node_run ADD COLUMN output_ref text;  -- R2 key when output > 256KB
```

**Keep `job` small.** Move terminal rows to `job_archive` hourly. A queue table with millions of dead rows makes the claim query progressively slower and autovacuum miserable.

### 3.1 Schema ownership between Prisma and Kotlin

You have `prisma/` at the root and `apps/api-kotlin`. Two languages writing one database with one migration tool is a coordination hazard.

**Draw the line by domain:**

| Owner | Tables | Rationale |
|---|---|---|
| **Prisma / TypeScript** | workflow, workflow_version, agent, tool, connection, integration, template, workspace, member, audit_log | Definition and CRUD. The web app's natural domain. |
| **Kotlin** | job, run, node_run, event, checkpoint, timer, side_effect, workspace_inflight, dead_letter | Execution. Hot path, complex transactions, needs precise control. |

Prisma owns **all** migrations (single source of truth, single migration history). Kotlin reads via generated types — jOOQ generated from the live schema is the cleanest option, and it fails your build when a Prisma migration breaks a Kotlin query, which is exactly the feedback you want.

Kotlin does not write to Prisma-owned tables and vice versa. Cross-domain reads are fine.

---

## 4. Infrastructure

### 4.1 Current spend

| Service | ₹/month | Assessment |
|---|---|---|
| Railway | 2,000 | Poor value for JVM. You're paying platform margin on idle memory. |
| Upstash Redis | 650 | Wrong tool for the queue. Right tool for rate limiting and cache. |
| Neon Postgres | 1,500 | **Keep.** Branching, PITR, and managed backups are worth this for a solo dev. |
| Vercel | 0 | See warning below |
| **Total** | **4,150** | |

> ⚠ **Vercel Hobby prohibits commercial use.** Onboarding users and pitching investors puts you outside those terms. Budget for Pro ($20 ≈ ₹1,700) before you go public. This is a real account-suspension risk at the worst possible moment.

### 4.2 The core cost insight

Railway is convenient and expensive. Hetzner is cheap and requires you to know Docker.

| | Railway (~₹2,000) | Hetzner CPX31 (~₹1,470) |
|---|---|---|
| vCPU | ~1 shared | 4 dedicated |
| RAM | ~1GB | 8GB |
| Disk | ephemeral | 160GB NVMe |
| Ops burden | zero | Docker Compose + Caddy |

**Roughly 5× the compute for less money.**

And here is the argument that makes this specifically right for *your* product: **your workers are the most crash-tolerant component you own.** Leases, checkpoints and event sourcing mean a worker can be killed mid-run and the work resumes. That is the entire product thesis. Running workers on cheap infrastructure isn't cutting corners — it's dogfooding your own durability guarantee. If it doesn't survive there, it doesn't work, and you'd rather find out now than in front of a customer.

### 4.3 Recommended topology

**Stage 1 — now through investor demos (~₹5,900/mo)**

| Component | Host | ₹/mo | Why |
|---|---|---|---|
| Web (Next.js) | Vercel Pro | 1,700 | Edge, previews, zero ops. Worth it. |
| api-kotlin | Railway | 1,000 | Scale to one small instance. Zero-downtime deploys matter for the API. |
| worker-kotlin ×2 | Hetzner CPX31 | 1,470 | Two containers, ~200 concurrent steps each |
| Redis | same Hetzner box | 0 | Rate limits, cache, SSE fan-out |
| Grafana + Prometheus | same Hetzner box | 0 | Self-hosted, free |
| Postgres | Neon Launch | 1,620 | Keep. |
| Object storage | Cloudflare R2 | ~100 | Large payloads. Free egress. |
| **Total** | | **~5,890** | Within budget |

Capacity: roughly **400 concurrent in-flight steps** versus your current 4. A 100× increase for ₹1,700 more per month.

**Stage 2 — cost optimisation once stable (~₹4,400/mo)**

Move `api-kotlin` onto the Hetzner box behind Caddy (automatic TLS), drop Railway entirely. Saves ₹1,000 and consolidates deployment. Do this *after* the demos, not before — don't be learning Caddy the week you're pitching.

**Stage 3 — if you get real traction**

Add a second Hetzner box in a different location, put workers behind it, and use Neon read replicas. Horizontal scaling is already free architecturally because workers are stateless and coordinate through Postgres — adding a box is `docker compose up` on new hardware.

### 4.4 Deployment for a solo developer

Optimise for "I have 90 minutes on a Saturday," not for elegance.

- **Docker Compose + Caddy** on the Hetzner box. Caddy gets you automatic Let's Encrypt with a four-line config.
- **GitHub Actions** builds images to GHCR, then SSHes and runs `docker compose pull && docker compose up -d`. Twenty lines of YAML.
- **Workers deploy with drain, not kill.** On SIGTERM: stop claiming new jobs, finish in-flight work (up to 60s), release leases explicitly, exit. Leases mean a hard kill is *survivable*, but a clean drain means it's *invisible*.
- **UptimeRobot** free tier on `/health`. Alerts to your phone.
- **Neon PITR** covers database backups. Verify a restore once, before you need it.

### 4.5 What to consolidate

You have four deployable units (`api-kotlin`, `telemetry`, `web`, `worker-kotlin`) plus three packages. For a solo developer, `apps/telemetry` as a separate service is ops burden without payoff at this scale.

**Fold `telemetry` into a library** consumed by both API and worker, writing to Postgres and exposing Prometheus metrics on `/metrics`. One fewer thing to deploy, monitor, and debug at 2am. Split it back out when you have a team.

---

## 5. Surviving the stress test

You will onboard users who click everything. Here is what they will break, and the guard for each.

### 5.1 Failure modes and guards

| # | Attack | Result today | Guard |
|---|---|---|---|
| 1 | Fan out 1,000 parallel nodes | Platform-wide starvation | Per-workspace in-flight cap (§2.3) |
| 2 | Infinite loop in an iterative agent | Burns quota and slots forever | Max steps/run, max wall-clock/run, cost ceiling/run |
| 3 | Tool pointed at a 60s-timeout endpoint, called 200× | Connection pool exhaustion | Per-connection concurrency cap + per-host limits |
| 4 | 50MB output from a node | Worker OOM, all leases orphaned | Payload cap; >256KB offloads to R2 |
| 5 | Malformed workflow crashes the worker | Reclaim → crash → reclaim, forever | `max_attempts` → dead letter |
| 6 | 500 runs created in one second | Neon connection exhaustion | Admission control + rate limit on run creation |
| 7 | Lease expires mid-execution | Two workers complete the same node | Fencing tokens (§2.6) |
| 8 | Retry after a partially-applied side effect | Duplicate emails sent | Idempotency keys (§2.6) |
| 9 | Provider returns 429 continuously | Retry storm amplifies the problem | Token bucket per connection + circuit breaker |
| 10 | Ten schedules fire at 09:00 together | Thundering herd | Jitter on schedule fire; overlap policy enforced |

### 5.2 Admission control

When the system is saturated, **reject clearly rather than accept silently.** A user who sees "Queue is full — your run is #47, about 3 minutes" trusts you. A user whose run sits in `queued` for twenty minutes with no explanation writes the negative review you're worried about.

```
queue depth < 100         → accept, run immediately
100–500                   → accept, show queue position + ETA in the UI
> 500 for this workspace  → reject with "Workspace concurrency limit reached"
> 2000 global             → reject non-priority, keep the demo lane open
```

Surface queue position on the Runs page. Your Control page (P10) should show real queue depth — dogfooding your own observability is also a genuinely good investor story.

### 5.3 The demo lane

**Do this before your first investor call.**

Reserve a slice of capacity — say 20 slots — for a flagged workspace, claimed with `priority = 100`. Your demo never queues behind a stranger's stress test.

The alternative is discovering, live, on a call, that someone in another timezone just fanned out 500 nodes.

### 5.4 What to watch

Emit these; put them on a Grafana dashboard and on your own Control page:

```
job_queue_depth{workspace, priority}
job_claim_latency_seconds        p50, p95, p99
job_execution_duration_seconds   by node_kind
worker_in_flight{worker_id}
worker_slots_available
lease_expiry_total               ← non-zero means workers are dying or overloaded
dead_letter_total                ← should be ~0
side_effect_dedupe_total         ← proves idempotency is working
db_pool_wait_seconds             ← rising means the DB pool is the bottleneck
provider_429_total{provider}
run_suspended_total              ← should be free; confirm it isn't holding slots
```

**Three alerts only** (more and you'll ignore them): claim latency p95 > 30s · lease expiry rate > 1/min · dead letter > 0.

---

## 6. Sequencing

You are solo with a full-time job. Ordered by value per hour spent.

**Week 1 — the fix that matters most (~6 hours)**
Raise concurrency from 4 to ~200 using coroutines and a semaphore. Add the per-workspace in-flight cap. Verify suspension releases slots. Raise the LLM HTTP connection pool.
→ *This alone takes you from 4 concurrent steps to ~200 with fairness, on your existing infrastructure, changing no services.*

**Week 2 — correctness (~10 hours)**
Move the queue into Postgres with transactional enqueue. Add fencing tokens and idempotency keys.
→ *Eliminates the silent-stall and double-execution bug classes before strangers touch it.*

**Week 3 — infrastructure (~8 hours)**
Provision Hetzner, Docker Compose, Caddy, GitHub Actions deploy. Move workers. Scale Railway down.
→ *~5× compute, roughly cost-neutral.*

**Week 4 — resilience (~8 hours)**
Admission control, circuit breakers, run-level ceilings, dead letter, demo lane, Grafana.
→ *Ready for strangers.*

**Week 5 — prove it (~4 hours)**
Load test: 50 workspaces × 20 concurrent runs. Kill a worker mid-run and confirm resumption. Verify no duplicate side effects.
→ *Now you can say "we handle X concurrent runs" with a number you measured.*

Roughly 36 hours of focused work. Weeks 1–2 are non-negotiable before onboarding anyone.

---

## 7. Summary

| Question | Answer |
|---|---|
| Why is concurrency 4? | Configuration, not capacity. Your work is I/O-bound; use coroutines. |
| Why do users block each other? | One global queue with no fairness. Add per-workspace caps. |
| Biggest hidden risk? | Dual-write between Postgres and Redis silently stalls runs. |
| Should I keep Redis? | Yes — for rate limiting, cache and SSE. Not for the queue. |
| Should I leave Neon? | No. Managed Postgres with PITR is worth ₹1,620 to a solo dev. |
| Should I leave Railway? | Workers yes, API later. Hetzner gives ~5× compute per rupee. |
| Can I afford this? | ~₹5,900/mo including Vercel Pro. Drops to ~₹4,400 at stage 2. |
| Realistic capacity after? | ~400 concurrent in-flight steps, ~100× today. |
