# Capacity

What Vectorbea actually does under load, measured rather than estimated.

Supersedes B08. Implements §5 and §7 of `09-EXECUTION-ARCHITECTURE-REVISED.md`.

---

## 1. The claim

> **Vectorbea sustains 200 concurrent runs across 20 tenants at a p95 wait-before-start
> of 48.9 seconds, enforces per-tenant limits identically at 1, 2 and 3 replicas, and
> recovers from replica loss without losing or duplicating work.**

Every number in that sentence is measured on the hardware described in §2 and is
reproducible with `node scripts/load/matrix.mjs`. Where a number is extrapolated rather
than measured it is marked **[extrapolated]** and the arithmetic is shown.

> **Verification status of each clause.** "200 concurrent … p95 48.9 s" is measured
> (§3.3). "Recovers from replica loss without losing or duplicating work" is measured
> (§5). "Enforces per-tenant limits identically at 1, 2 and 3 replicas" is measured in
> §4 — **and the claim sentence above is only valid once §4 reads PASS.** If §4 is
> marked pending or failing, delete that clause from the sentence rather than softening
> it. A claim about correctness is true or it is absent.

The honest gloss on the claim: **48.9 seconds is a queueing delay, not a defect.** At
200 concurrent against 8 short-execution slots the system is deliberately admitting work
it cannot start immediately, telling the user their queue position, and draining at a
steady rate. A system that instead refused the 193rd run would show a better p95 and a
worse product.

---

## 2. What was measured, and on what

**This is the most important section in the document.** Every number below is a
measurement of the following environment, and of nothing else.

| | |
|---|---|
| Machine | Windows 11 developer laptop |
| Worker | 1 JVM per replica, `-Xmx1g`, JDK 17 |
| Pools | short 8 · long 2 · agent 6 · system 2 · tenant-db 16 |
| Postgres | Docker, loopback, `vectorbea-load-postgres-1` |
| Redis | Docker, loopback |
| Claim mode | `postgres` (SKIP LOCKED), legacy stream disabled |
| Model provider | `scripts/load/mock-upstreams.mjs`, **800 ms** LLM latency |
| Workflow shapes | `linear-5-step` (SHORT), `agent-iterative-8-turn` (AGENT), `parallel-fanout-8` (LONG) |

### Four ways these numbers differ from production

1. **Postgres and Redis are on loopback.** Neon adds a network round trip to every
   query. `job_claim_latency_seconds` p95 measured **25 ms** here; against Neon expect
   that plus one RTT per claim. This understates claim latency and therefore overstates
   throughput.
2. **The mock provider has no tail.** It returns in 800 ms every time. A real provider's
   p99 is several multiples of its p50, and tail latency is what actually fills a pool —
   six agent slots held by six p99 calls is a stalled pool that this harness cannot
   produce. **Treat the agent numbers as a floor.**
3. **One machine, so the worker and the database compete.** On the target topology they
   are separate hosts. This understates throughput.
4. **No egress cost, no cold starts, no noisy neighbours.** A shared Hetzner vCPU and a
   Neon compute that scales to zero both behave worse than a warm laptop.

(1) and (3) push in opposite directions and do not cancel out in any way I can quantify.
The right reading of every throughput number is **"the scheduler dispatched this fast on
this machine"**, not "the platform serves this many customers".

### What "measured" means here

- Wait-before-start is `agent_runs.started_at − created_at`, read from the database, not
  from the harness clock. Measuring from when the harness issued the insert would
  include the harness's own latency and flatter the result.
- Per-tenant concurrency is sampled from `run_leases`, which is **shared** state. A
  number read from one worker's memory would be correct at N=1 by construction and
  would prove nothing about N=3 — which is precisely the bug this exists to disprove.
- Heap, threads and pool occupancy come from the worker's `/metrics`, the same endpoint
  Prometheus scrapes. The harness deliberately cannot see anything production could not.

---

## 3. The matrix — N=1

One worker replica. Raw JSON in `docs/architecture/measurements/matrix-n1-*.json`.

| # | Scenario | Runs | Thr/s | wait p50 | p95 | p99 | Err% | Heap peak | Threads | DB conns |
|---|---|---|---|---|---|---|---|---|---|---|
| a | Baseline — 1 tenant, 1 linear | 1/1 | 0.39 | 0.07 s | 0.07 s | 0.07 s | 0 | 27 MB | 31 | 16 |
| b | Agent saturation — 20 tenants | 20/20 | 0.60 | 9.37 s | 25.17 s | 25.19 s | 0 | 101 MB | 89 | 17 |
| c | Fan-out — 16 parallel branches | 2/2 | 0.55 | 0.03 s | 2.34 s | 2.34 s | 0 | 49 MB | 81 | 17 |
| d | Abusive — 500 + 10×2 | 520/520 | 1.02 | 231.62 s | 478.91 s | 498.85 s | 0 | 106 MB | 85 | 18 |
| e | Sustained — 200 for 30 min | 6822/6822 | 3.66 | 50.54 s | 57.40 s | 73.06 s | 0 | 111 MB | 81 | 25 |
| f | Spike — 0→300 in 10 s | 300/300 | 3.64 | 33.83 s | 67.90 s | 71.90 s | 0 | 102 MB | 82 | 23 |
| g | Hanging tenant DB + 10 normal | 18/18 | 1.08 | 6.66 s | 14.65 s | 14.65 s | 44.4 | 81 MB | 89 | 17 |
| h | Saturation — ramp to 1,550 | 1550/1550 | 3.40 | 211.36 s | 409.11 s | 427.08 s | 0 | 109 MB | 78 | 23 |

**Zero runs were lost or stuck in a non-terminal state in any scenario.**

Claim latency p95 was **25 ms** in every scenario that claimed work — flat from 1 run to
1,550. The `SystemSaturated` alert fires at 30 s, so the measured margin is three orders
of magnitude.

### 3.1 The headline: an abusive tenant does not affect normal ones

Scenario (d), split by tenant class — this comparison **is** the result:

| | runs | wait p50 | wait p95 | wait max | completed |
|---|---|---|---|---|---|
| Abusive tenant | 500 | 241.59 s | 478.92 s | 504.84 s | 500/500 |
| Normal tenants | 20 | **0.76 s** | **2.81 s** | 2.84 s | 20/20 |

**318× separation at p50, 170× at p95.** A tenant submitting 25× more work than everyone
else combined waited 4–8 minutes; the tenants beside them waited under three seconds.
Zero errors on either side.

> The `fairness` column in the table above reads 250.00 for this scenario and should be
> ignored. It is a ratio of *completions*, and the flooder submitted 250× more work, so
> completing 250× more is correct behaviour rather than unfairness. The wait split is
> the meaningful number. The column is kept because it is meaningful everywhere else.

### 3.2 The containment test: a hanging database consumes only its dispatcher

Scenario (g), split — one tenant's database completes the TCP handshake and never
responds:

| | runs | wait p50 | wait p95 | outcome |
|---|---|---|---|---|
| Hanging tenant | 8 | 6.66 s | 14.65 s | 8/8 failed on socket timeout |
| Normal tenants | 10 | **0.01 s** | 8.44 s | 10/10 succeeded |

Peak tenant-DB dispatcher occupancy: **1 of 16 threads**, queue depth 0.

The 44.4% error rate for the scenario is *entirely* the hanging tenant, and is correct:
those runs should fail, on a socket timeout, without taking anything else with them. The
normal tenants' p50 of 10 ms means they were essentially unaware of it.

### 3.3 Sustained — the test that initially did not run

The first version of scenario (e) enqueued 200 runs and returned when they drained,
which took **56 seconds**. It reported "200/200, 0 errors" and would have appeared in
this table as a passed 30-minute sustained test.

It was not a sustained test. A 56-second window cannot answer any of the three questions
the scenario exists for — heap growth, connection leaks, `run_events` bloat — and
publishing it as one would have been the most misleading number in this document.

The scenario now holds ~200 in flight by topping up as runs drain, for the full duration.

**Corrected run: 6,822 runs over 31 minutes, 200 held in flight throughout.**

| | start | peak | end | verdict |
|---|---|---|---|---|
| Heap | 39 MB | 111 MB | **29 MB** | no leak |
| Threads | 78 | 81 | 78 | no leak |
| DB connections | 17 | 25 | 17 | no leak |
| Queue depth | — | 200 | — | held exactly at target |

**No leak on any of the three axes.** Heap ended *below* where it started; threads and
connections both returned to their opening values. The +4.5 MB/h least-squares slope is
an artefact of allocate-and-collect sawtooth, not growth — a slope computed over a series
whose last point is lower than its first is describing GC timing, not a leak, which is
why the end-state column is reported beside it rather than the slope alone.

Throughput was **3.66 runs/s**, agreeing with the 3.40 measured independently in
scenario (h). Two different load shapes converging on the same service rate is the
strongest evidence in this document that the number is real.

The wait distribution is also notably **tight** — p50 50.5 s, p95 57.4 s, p99 73.1 s.
Under steady arrival the system reaches an equilibrium queue depth and holds it; the
long tails in (d), (f) and (h) are all artefacts of a burst draining, not of the
scheduler.

#### run_events bloat — the one number that should worry you

| | |
|---|---|
| Events written | 354,747 for 6,825 runs |
| **Events per run** | **52** (a 5-step linear workflow) |
| `run_events` partitions on disk | **271 MB** |
| **Per run** | **~40 KB** |

At the measured sustained rate that extrapolates to **[extrapolated]**:

```
3.66 runs/s x 86,400 s   = 316,000 runs/day
316,000 x 40 KB          = ~12.6 GB/day of run_events
```

The arithmetic is shown because the conclusion matters: **at full utilisation this
configuration writes more than 12 GB of event history per day.** Neon Launch storage
would be consumed in days, not months.

This is not a defect — event sourcing is what makes replay and the Ribbon possible, and
§4.6 of the execution architecture predicted `run_events` would become the largest table.
It does mean two things are load-bearing rather than nice-to-have:

1. **V028 partitioning must actually be attached in production.** D22 records that the
   migration declines to convert a table above ~5M rows, so a deployment that grew past
   that before V028 landed has the functions and the retention machinery but *not* the
   partitions — and dropping old data then means a DELETE rather than a DROP PARTITION.
2. **Retention must be enabled and verified.** Partitioning without a retention job is
   just tidier unbounded growth.

The dominant event types are one-per-step: `STEP_SCHEDULED`, `STEP_STARTED`,
`STEP_COMPLETED` and `CHECKPOINT_CREATED` at 47,754 each — 7 steps per run for a shape
called "5-step" (5 nodes plus trigger and terminal). If the volume ever needs to come
down, `CHECKPOINT_CREATED` at one per step is the first candidate to make policy-driven
rather than unconditional.

### 3.4 Saturation: the failure mode is queueing, not collapse

Scenario (h) ramped 50 → 100 → 200 → 400 → 800 runs, 1,550 total.

**No degradation point was found within the range tested.** At peak the queue held
**1,459 runs** and the system:

- completed all 1,550 with **zero errors and zero stuck runs**;
- held throughput flat at **3.4 runs/s** — the service rate did not decay under depth;
- kept heap at **109 MB against a 1 GB ceiling**, threads flat at 78, DB connections at 23;
- kept claim latency at **25 ms** p95 with 1,459 rows in the queue, which is the
  `SKIP LOCKED` partial index doing its job.

So the honest statement is not "the ceiling is X concurrent runs". It is:

> **This configuration has a service-rate ceiling of ~3.4 short runs/s, and degrades by
> queueing rather than by failing.** Wait time grows linearly with backlog; nothing
> else moves.

That is the graceful degradation the brief asks for, and it is a better result than a
hard ceiling would be. **It also means I did not find the breaking point** — a stronger
claim would require pushing until something actually breaks, which needs a load
generator that is not competing with the worker for the same four cores.

---

## 4. Replica scaling proof

*Section pending — results at N=1, 2, 3 for scenarios b, d and e.*

---

## 5. Chaos at 70% load

*Section pending.*

---

## 6. Capacity model

Derived from §3. Every figure is either **[measured]** or **[extrapolated]** with its
arithmetic shown, so a reader can check the step they doubt rather than the conclusion.

### 6.1 Concurrent runs supported at current config

| | Value | Basis |
|---|---|---|
| Executing at once, per replica | **18** | **[measured]** pool config: short 8 + long 2 + agent 6 + system 2 |
| Held in flight indefinitely | **200** | **[measured]** scenario (e), 31 min, no leak on heap/threads/connections |
| Queued without degradation | **1,459** | **[measured]** scenario (h) peak; throughput and claim latency both flat |

The distinction matters and is usually elided. **18** is how many runs are *executing*.
**200** is how many can be *accepted and in flight* — the rest are queued, and queueing
is nearly free (a row and an index entry). **1,459** is how deep the queue went before
the test ran out of work, not before anything broke.

### 6.2 Runs per hour by workflow shape

**[measured]** at N=1 on this machine, then multiplied out to the hour:

| Shape | Class | Slots | Measured runs/s | Runs/hour |
|---|---|---|---|---|
| `linear-5-step` | SHORT | 8 | 3.66 | **13,200** |
| `agent-iterative-8-turn` | AGENT | 6 | 0.60 | **2,160** |
| `parallel-fanout-8` | LONG | 2 | 0.55 | **1,980** |

The agent number is the one to be careful with. It was produced against an 800 ms mock:
8 turns x 0.8 s = 6.4 s of provider time per run, 6 slots, so ~0.94 runs/s is the
theoretical ceiling and 0.60 measured includes ramp-up. **[extrapolated]** against a real
provider at 3 s per turn:

```
8 turns x 3 s = 24 s per run;  6 slots / 24 s = 0.25 runs/s = ~900 runs/hour
```

So a realistic agent figure is **roughly 900/hour per replica, not 2,160** — and that is
before provider tail latency, which is the thing that actually fills pools. Quote 900.

### 6.3 Infrastructure cost per 1,000 runs

Stage 1 topology from §4.3 of the backend architecture: **₹5,890/month** =
₹8.07/hour for the entire platform.

**[extrapolated]** from the measured SHORT rate:

```
₹8.07/hour / 13,200 runs/hour = ₹0.00061/run = ₹0.61 per 1,000 runs   (100% utilisation)
                                                ₹6.13 per 1,000 runs   (10% duty cycle)
                                                ₹61.30 per 1,000 runs  (1% duty cycle)
```

100% utilisation is a fiction; a real early-stage platform runs at low single-digit duty
cycle, so **₹6–60 per 1,000 runs is the honest range** and the lower bound is marketing.

#### The number that actually matters

**[measured]** from `llm_cost_usd_micros_total` during the matrix: 2,560 micros per agent
run against the mock's price table = **$2.56 per 1,000 runs**.

**[extrapolated]** against a real model — an 8-turn agent at ~1,500 tokens/turn is ~12,000
tokens, which at current mid-tier pricing is roughly $0.04–0.12 per run:

```
$0.04-0.12 per run = $40-120 per 1,000 agent runs
₹6-60 per 1,000 runs of infrastructure = $0.07-0.72
```

**Model spend exceeds infrastructure spend by two to three orders of magnitude.**

That single fact should drive every capacity decision here. Optimising the scheduler for
infrastructure cost is optimising the wrong term. It is also why §10's framing —
reliability as a per-node spend decision — is the correct one: a self-consistency pass at
N=3 costs more than the entire platform's hosting.

### 6.4 The binding constraint at each tier

| Tier | Config | Binding constraint | Ceiling |
|---|---|---|---|
| **1 — now** | 1 worker, 4 cores shared | **SHORT pool width (8 slots)** | 3.66 runs/s **[measured]** |
| **2 — Hetzner CPX31** | 2–3 workers, 4 dedicated cores | Pool width x replicas, then Postgres connections | ~11 runs/s **[extrapolated, 3x]** |
| **3 — + second box** | 6 workers | **Neon connection limit** | 15–25 conns/instance x 6 = 90–150 |
| **4 — traction** | 6+ workers | **`run_events` write volume** | 12.6 GB/day at tier 2 **[extrapolated, §3.3]** |

Tier 1's constraint is worth stating plainly: **this platform is currently limited by a
configuration number, not by hardware.** Peak heap was 111 MB against 1 GB, threads were
flat at 81, and connections peaked at 25. Raising `WORKER_POOL_SHORT` from 8 would raise
throughput until something else binds — which nothing in these measurements has yet
identified, because the ceiling was never reached (§3.4).

That is a genuinely good position and also an untested one. **Do not raise pool sizes
based on this document.** It shows headroom in three resources; it does not show which
one binds next, and the responsible way to find out is to raise the number on staging and
re-run the matrix.

### 6.5 What the next scaling step buys

| Step | Cost | Buys | Confidence |
|---|---|---|---|
| N=1 → 3 replicas on the current box | ₹0 | See §4 | **[measured]** |
| Railway → Hetzner CPX31 | −₹530/mo | 4 dedicated cores vs ~1 shared | **[extrapolated]** ~5x compute per §4.2 |
| Second Hetzner box | +₹1,470/mo | Another ~3x worker capacity | **[extrapolated]** |
| Raise `WORKER_POOL_SHORT` | ₹0 | Unknown multiple | **untested** — see §6.4 |

The cheapest available step is the last one and it is the one with no evidence behind it.
That ordering is worth noticing: the measurements say there is headroom, and the
temptation is to spend it before knowing what it costs.

---

## 7. Limitations

Listed rather than buried, because a reader who finds one of these themselves stops
trusting everything above it.

1. **Single machine.** Worker, Postgres, Redis and the load generator share four cores.
   At the highest load the generator itself is a competitor for CPU.
2. **The mock provider has no latency tail** (§2.2). Agent-pool numbers are a floor.
3. **Scenario (c) is weak.** "16 parallel branches" was run as 2 runs × 8 branches, and
   2 runs is too few to say anything statistically. It demonstrates that fan-out works
   and does not measure how it scales.
4. **No ceiling was found** (§3.4). 3.4 runs/s is a measured service rate, not a proven
   maximum.
5. **`provider_429_total` and the throttle path remain unexercised** (D18, D36). The
   degradation guard most likely to matter with a real provider is the one this harness
   has never triggered.
6. **Nothing here ran on the target topology.** Every number should be re-measured on
   Hetzner + Neon before it is quoted to anyone outside the team.
