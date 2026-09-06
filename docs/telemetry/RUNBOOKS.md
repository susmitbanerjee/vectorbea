# Alert runbooks

One section per alert. CI fails if an alert exists without one
(`node scripts/monitoring/validate.mjs`), because an alert with no documented
response is noise that wakes someone up.

**Every section answers the same four questions, in the same order:** what fired, what
it actually means, what to check first, and what "fixed" looks like. The order matters
at 3am — the diagnosis has to come before the theory.

## How to read a page

- `severity: page` fires **only for production** and only for the three fleet alerts.
  Everything else, and everything from staging, is `severity: ticket` — email, no
  wake-up, act during the working day.
- Every alert carries `environment`. Check it before doing anything: a staging
  incident and a production one need very different urgency.
- Start at the dashboard the alert links to. The `$env` selector at the top-left of
  every dashboard must be set to the environment in the alert.

Dashboards: <https://telemetry.vectorbea.com>

---

## SystemSaturated

**Severity:** page (production only) · **Dashboard:** Fleet health

Claim latency p95 has been above 30s for five minutes. Runs are ready and no worker is
taking them.

This is the earliest honest saturation signal the platform has. Nothing has failed yet:
throughput is flat, error rate is zero, runs are simply not starting. By the time a
customer complains it has usually been high for an hour.

**Check, in order:**

1. **Fleet health → "Slots available".** At or near zero across the fleet means the
   fleet is undersized. Scale the worker replica count on Railway. This is the common
   case.
2. **Not zero?** Then workers are alive and idle while work waits, which is a claim
   problem, not a capacity problem. Check "Claim latency" split by class — if one lane
   is slow and the others are not, that lane's pool is exhausted rather than the fleet.
3. **All lanes slow with free slots** means the claim query itself has degraded. Confirm
   the plan still walks `agent_runs_claim_idx` rather than sorting. This has happened
   after a bulk insert changed the table statistics.
4. **Check `db_pool_wait_seconds` p95.** A claim cannot be fast if acquiring a
   connection is slow, and pool starvation presents as claim latency.

**Resolved when:** claim latency p95 is back under 30s. If you scaled to fix it, decide
deliberately whether to scale back — this alert firing weekly at the same hour is a
capacity plan, not an incident.

**Do not:** restart workers as a first move. A restart drops every lease in flight and
turns a slow platform into a duplicated-execution problem.

---

## WorkersDyingOrOverloaded

**Severity:** page (production only) · **Dashboard:** Fleet health

Run leases are expiring faster than one per minute. A lease expires when a worker
holding a run stops heartbeating for its TTL.

**This means runs are being executed twice**, up to the point of the fence. That is the
urgency: it is not only a fleet problem, it is a correctness problem, and side effects
past the fence may have happened more than once.

**Check, in order:**

1. **`jvm_heap_used_bytes` against `jvm_heap_max_bytes`.** Sitting at the ceiling means
   OOM kills. Restarting does not fix an undersized heap — raise it.
2. **`thread_blocked_seconds` per pool.** If it approaches `worker_pool_slots_total` for
   a pool, that pool is not computing, it is waiting on outbound I/O. Adding replicas
   buys nothing; the upstream is the problem.
3. **`side_effect_dedupe_total`.** Non-zero here is the exactly-once machinery catching
   the duplicates this alert implies. Zero while leases expire is worth investigating
   separately — it may mean the effects being repeated are not guarded.
4. **Railway deploy log.** A rolling deploy expires leases legitimately. Correlate the
   spike against a deploy before treating it as an incident.

**Resolved when:** lease expiry rate is back under 1/min. Then check
`fenced_write_total` for the same window to size how much double execution occurred.

**Note:** this alert **inhibits** `SystemSaturated` — a dying fleet makes everything
slow, and one incident should be one page.

---

## DeadLetterNeedsAttention

**Severity:** page (production only) · **Dashboard:** Fleet health

A job exhausted its retries and was parked. Retrying did not help and will not.

`for: 0m` — this fires on the first occurrence, deliberately. A dead letter never
resolves itself, and one is enough to be worth a look.

**Check:**

1. `GET /api/dead-letters` — read the payload and the failure reason.
2. Classify it. A `CONFIG` or `INPUT` failure is a customer's broken workflow and needs
   a support reply, not an engineering fix. `INFRA` or `TIMEOUT` is ours.
3. Decide explicitly: fix and requeue, or discard. Leaving it parked is also a decision,
   but make it one.

**Resolved when:** the alert auto-resolves after 15 minutes with no new dead letters.
That is not the same as the dead letter being handled — the queue does not empty itself.

---

## ScheduledJobStale

**Severity:** ticket · **Dashboard:** Scheduled jobs

A background loop has not completed successfully in more than three of its own
intervals.

**This alert exists because of a specific, repeated failure.** Loops that stopped were
previously invisible — no metric changed when a scheduler thread died — and the
consequence surfaced weeks later as something else entirely. That is the pattern behind
the uncalled functions in V028 and V046.

**Check, in order:**

1. **`job_runs_total{job_name="…"}` on the Scheduled jobs dashboard.** This is the
   diagnosis, and it splits into two completely different problems:
   - **No series at all** → the loop is **not running**. The thread died, or `start()`
     was never called. Check the service logs at startup.
   - **`outcome="failed"` climbing** → the loop **is running and failing every pass**.
     Read the service log for that job's prefix (`[partitions]`, `[retention]`,
     `[reconciler]`, …).
2. **Check the environment label.** Some jobs are legitimately disabled in some
   deployments — `ResumeReconciler` honours a disable flag, `BillingScheduler` honours
   `BILLING_JOBS_ENABLED=false`. A disabled job never registers, so it will not appear
   at all rather than appear stale. If it appears stale, it is enabled and broken.

**Per-job consequence, so you can judge urgency:**

| Job | If it stays stopped |
|---|---|
| `partition-maintenance` | Partitions stop being created. `run_events` has **no default partition** — when the last pre-created month elapses, every event write errors. See also `PartitionMaintenanceFailing`. |
| `retention-sweep` | Data past its retention window is not deleted. A compliance problem and a bill. |
| `retention-export-drain` | Customer-requested exports never complete. Someone pressed a button and is waiting. |
| `resume-reconciler` | Runs parked with nothing coming for them are never rescued. They stay parked forever. |
| `crash-recovery` | Runs held by dead workers are never returned to the queue. |
| `timer-scheduler` | Timers never fire — every delayed or scheduled step stalls. |
| `worker-heartbeat` | The fleet view goes stale and lease recovery starts acting on bad data. |
| `workflow-scheduler` | Cron-scheduled workflows stop running. Customer-visible, and silent. |
| `billing-scheduler` | Subscriptions do not settle, dunning does not apply, usage is not reported. |

**Resolved when:** the job completes one successful pass. The timestamp advances on
success only — a job that runs and fails does **not** clear this.

---

## PartitionMaintenanceFailing

**Severity:** ticket · **Dashboard:** Trace pipeline health

Either the maintenance pass threw, or the drop gate refused to drop expired partitions.

Its own alert rather than a case of `ScheduledJobStale`, because the consequence is
specific and delayed: partitions stop being created, inserts land in the default
partition, and nothing looks wrong until a query that assumed partition pruning starts
scanning everything. By then the default partition is large enough that fixing it is an
outage.

**Check `worker_partition_drops_gated_total` by `reason`:**

- **`work_outstanding`** — the gate is working correctly. Partitions past the hot window
  have not been exported yet, so it is refusing to drop them. Fix the exporter; do not
  bypass the gate. This is the less urgent of the two.
- **`gate_unavailable`** — **more urgent.** The export state could not be read at all,
  so the gate cannot evaluate and nothing will drop until a person acts. Disk grows
  until someone notices.

**Also check:** how far ahead partitions currently exist. The job creates the current
month plus two, so there is normally a wide margin — but that margin is exactly what
makes a stopped job survivable for weeks and then not.

**Resolved when:** a maintenance pass completes cleanly and the gate stops refusing.

---

## TelemetryDropsNonZero

**Severity:** ticket · **Dashboard:** Trace pipeline health

A bounded buffer filled and started discarding. **The `signal` label says how bad this
is, and the three are not equivalent.**

### `signal=event` — the serious one

An event hole breaks timeline paging on `?afterSequence=`, and a lost `RUN_FAILED` is
an outage reported as a success.

`RunEventStore` applies **back-pressure before it drops** — it blocks the emitting
thread rather than losing an event. So a drop means it blocked past
`AGENT_EVENT_BACKPRESSURE_TIMEOUT_MS` and gave up, which means **the database was not
answering**.

1. Check `db_pool_wait_seconds` p95/p99. This is almost always the cause.
2. Check Postgres health directly — connection count, long-running queries.
3. The deadline exists so a non-answering database does not park every thread in the
   process. If it is being hit, the database problem is the incident; the drops are the
   symptom.

### `signal=span` — degraded, not dangerous

`SpanWriter` drops and counts by design rather than blocking execution. A dropped span
is an incomplete trace. Also persisted to `agent_runs.dropped_spans`, because "was this
trace complete" gets asked hours later, long after the counter has moved on.

Check the `reason` label. Sustained drops usually mean span volume has outgrown the
buffer — a run shape changed, not an outage.

### `signal=export` — customer-visible

A workspace's own OTLP destination is rejecting. This is a feature **they configured**
failing, and they cannot see why.

Check `workspace_otel_exports.last_error` and `last_error_at` for the affected
workspace. Common causes: a rotated bearer token, an endpoint that moved, a receiver
that does not accept `http/protobuf`. This is a support conversation, not a platform
fix.

**Resolved when:** the drop counters stop increasing for 15 minutes.

---

## ProviderThrottlingHigh

**Severity:** ticket · **Dashboard:** Provider capacity

Either 429s are arriving faster than 5/min, or one arrived on a call the local capacity
bucket had **already admitted**.

**The single most useful comparison is on one panel row:**

| `provider_429_received` | `provider_capacity_exhausted` | Meaning |
|---|---|---|
| climbing | flat | **Our bucket is set too high.** Lower it. We are not refusing ourselves and the provider is refusing us. |
| climbing | climbing | We are genuinely at the provider's ceiling. Request a quota increase. |
| flat | climbing | The bucket is working. **Not a problem.** This is why refusals alone are not alerted. |

**`provider_429_after_admit` non-zero is a bug in the bucket, not a provider problem.**
It means the bucket let through a call it should have held. Three possible causes:

1. The configured limit is above the provider's real one.
2. The token estimate was short — check `provider_estimate_error_ratio` p95. Above 1.0
   is under-reservation, and it is the p95 calls that breach the limit.
3. Something outside this fleet is spending the same account's budget.

**Resolved when:** the 429 rate drops below threshold and no further post-admit 429s
occur. If you changed a bucket limit, note the old and new values somewhere — this
alert recurring with a different limit each time is how a limit ends up at a number
nobody can justify.

---

## WorkspaceCostAnomaly

**Severity:** ticket · **Dashboard:** Workspace support (set `$workspace` to the one
named in the alert)

One workspace's hourly spend is more than five times its own 24-hour average, and above
the $1/hour floor where that ratio starts to mean anything.

Compared against **its own history**, not a global constant — a fixed dollar threshold
never fires for a small customer whose spend has gone insane, and fires constantly for a
large one behaving normally.

**Check:**

1. **Runaway agent loop** — iterations climbing with no completions. The run ceiling
   should have caught it; check `run_ceiling_breach_total{dimension="steps"}`. If the
   ceiling did not fire, the ceiling is set too high for this workload.
2. **Legitimate batch** — run count climbing with normal per-run cost. Nothing to do
   except know about it.
3. **Model change** — check "Spend rate by model". A workflow switched to a more
   expensive model does this instantly and is usually deliberate.

**Resolved when:** the rate returns to the workspace's baseline. If it was a runaway
loop, the run ceiling is the fix, not a conversation.

**Note:** cost metrics are labelled by workspace and capped at 1,000 series by
`LabelGuard`. If the cap is being hit, the long tail collapses into `overflow` and this
alert stops working for small workspaces. Check `LabelGuard` series count before
trusting an absence of alerts.

---

## ScrapeAgentDown

**Severity:** page (production only) · **Dashboard:** any — check the `$env` selector

No metrics have been received from an environment for five minutes.

**This is a page rather than a ticket for one reason:** every dashboard for that
environment is now showing stale data that looks exactly like calm. The failure mode
this prevents is someone glancing at a green dashboard during a real incident.

**Check:**

1. **Is the `telemetry-agent` service running** in that Railway environment?
2. **If it is running, check its logs for 401s.** The overwhelmingly common cause is
   `TELEMETRY_INGEST_TOKEN` having been rotated on the central collector without
   updating the agent. The agent retries into a wall and says so.
3. **If not 401**, check whether the agent can reach the central collector's public
   endpoint at all — the collector is the only publicly-reachable part of the stack, and
   it is the only path in.
4. **Check the agent's own scrape targets.** A worker DNS name that changed means the
   agent is running, healthy, and collecting nothing.

**This alert inhibits every other alert for the same environment**, because with no data
the others are either stale or artefacts of the gap.

**Resolved when:** series resume arriving. Look at the gap afterwards — anything that
happened during it was not recorded and is not recoverable.

---

## CentralIngestFailing

**Severity:** ticket · **Dashboard:** Prometheus target health

The central collector is receiving telemetry but cannot hand it on to Prometheus or
Tempo.

The collector retries for 120s and holds a bounded sending queue, so a short restart of
either backend is absorbed with no loss. A **sustained** failure is not: once the queue
fills, this becomes data loss.

**Check:**

1. Is Prometheus (or Tempo — the `exporter` label says which) running and reachable on
   the monitoring project's private network?
2. For Prometheus specifically: is `--web.enable-remote-write-receiver` still set? The
   receive endpoint 404s without it, and the failure looks like a network problem.
3. Disk. Prometheus is capped at 4GB / 15d and Tempo at 72h; a full volume presents as
   write failures.

**Resolved when:** the failed-send rate returns to zero. Check the collector's queue
depth afterwards to confirm it drained rather than dropped.
