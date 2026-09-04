# Demo readiness

Six checks that have to be true before a live demo or an investor call. Each states its
**real** condition, not its intended one.

The point of this document is that it is uncomfortable to read. A green checklist that
was filled in aspirationally is worse than no checklist, because it is consulted instead
of the system.

**Status as of 2026-08-19: 2 of 6 ready. Do not run an unattended live demo.**

| # | Check | State |
|---|---|---|
| 1 | Demo lane verified under load | **READY** — measured, see §1 |
| 2 | Alerts routed to a phone you carry | **NOT READY** — configured, unrouted |
| 3 | Rollback tested in the last 7 days | **NOT READY** — never tested |
| 4 | Neon PITR restore verified in last 30 days | **NOT READY** — never verified |
| 5 | One-page runbook per failure mode | **READY** — §5 |
| 6 | Known limitations stated honestly | **READY** — §6 |

---

## 1. Demo lane verified under load — READY

The demo lane is `agent_runs.priority >= 100`, ordered ahead of `fair_vtime`, with
`CLAIM_RESERVED_PRIORITY_SLOTS=1` holding a slot back so a priority run cannot be locked
out by a full fleet.

**Measured** (Stage 6b, `docs/architecture/POSTGRES-CLAIM.md` §5): a priority run
claimed in **0.01 s** against a queue whose ordinary runs were waiting **9.57 s** —
roughly a thousandfold preemption.

> **What that measurement does not cover.** It was taken against a queue of tens of
> runs, not the 1,459 that scenario (h) produced. The number that actually matters for a
> demo is preemption depth — whether a priority run still claims in 10 ms when 1,400
> runs are ahead of it. The `SKIP LOCKED` claim orders by `priority DESC, fair_vtime` on
> a partial index, and claim p95 stayed flat at 25 ms across the whole ramp in (h), so
> there is good reason to expect it holds. **Expecting is not measuring.**
>
> Close it by running `priority-lane.mjs` while scenario (h) is mid-ramp. Until then
> this check is READY on the strength of a measurement taken under lighter load than a
> bad demo day would produce.

**Before the call:**

```bash
node scripts/load/priority-lane.mjs
```

Set the demo workspace's priority:

```sql
UPDATE workspaces SET demo_lane = true WHERE slug = 'the-demo-workspace';
```

**The failure mode this removes:** a stranger's load test, or an over-enthusiastic trial
user, filling the queue thirty seconds before a live demo. Without the lane that is a
demo that hangs on the first click with no recourse.

---

## 2. Alerts routed to a phone you carry — NOT READY

**What exists:** three alerts in `ops/monitoring/prometheus/alerts.yml`, an Alertmanager
route, and a notification body carrying the action for each.

**What does not:** `ALERT_EMAIL`, `SMTP_HOST`, `SMTP_USER` and `SMTP_PASSWORD` are unset.
Alertmanager will start, evaluate, fire — and deliver nowhere. It will not error, which
is the dangerous part: the stack looks healthy and the alerts are going into a void.

**To close it** (about 20 minutes):

1. Create a Resend or Postmark account — both have a free tier that covers three alerts.
2. Set the four variables on the Hetzner box.
3. Force a fire and confirm the phone buzzes:
   ```bash
   curl -XPOST http://127.0.0.1:9093/api/v2/alerts -H 'Content-Type: application/json' \
     -d '[{"labels":{"alertname":"SmokeTest","severity":"page"},"annotations":{"summary":"routing test","action":"ignore me"}}]'
   ```
4. Delete the alert and confirm the resolution arrives too. An alert channel that
   delivers firing but not resolved teaches you to distrust it.

**Until it is closed:** the monitoring is a dashboard you have to remember to look at.
That is materially different from alerting and should not be described as alerting.

---

## 3. Rollback tested in the last 7 days — NOT READY

**Never tested.** Not "tested and stale" — never.

There is a documented procedure in `docs/architecture/TYPED-QUEUE-MIGRATION.md` for the
queue migration specifically, and Railway supports redeploying a previous image. Neither
has been exercised, so what is unknown is not whether the button works but:

- whether the previous image still **starts** against the current database schema;
- how long a rollback takes end to end;
- whether in-flight runs survive it, or are lost, or are duplicated.

Migrations V020–V032 are additive, which is the property that *should* make rollback
safe — a previous image ignores columns it does not know about. **"Should" is doing all
the work in that sentence and it has never been checked.**

**To close it** (about an hour):

1. On staging, note the running image digest.
2. Enqueue 20 runs; while they are in flight, redeploy the previous digest.
3. Measure: did the old image boot? How many runs completed, failed, or vanished?
4. Roll forward. Record all of it in `docs/deployment/`.

**Do this before the first customer, not before the first demo.** A demo failure is
embarrassing; an un-rollbackable bad deploy with customer data in flight is not.

---

## 4. Neon PITR restore verified in the last 30 days — NOT READY

**Never verified.** Neon's point-in-time recovery is enabled and its retention window is
whatever the plan provides. No restore has ever been performed.

§4.4 of `05-BACKEND-ARCHITECTURE.md` says: *"Verify a restore once, before you need it."*
That has not happened, so what exists is a backup **setting**, not a backup.

The specific unknowns:

- how long a restore of the current data volume takes;
- whether the restored branch needs the Flyway chain re-run, or arrives complete
  (V032 provisioned cleanly from empty on 2026-08-19, so a fresh chain works — a
  *restored* one is a different question);
- whether the application can be pointed at a restored branch without a redeploy.

**To close it** (about 30 minutes):

1. Neon console → Branches → restore to a timestamp 1 hour ago, as a **new branch**.
2. Point a local API at the branch's connection string; run
   `node scripts/load/verify-metrics.mjs` and one workflow end to end.
3. Record the wall-clock restore time and the row counts.
4. Delete the branch.

---

## 5. Runbooks — READY

One page per failure mode. Each begins with the alert that fires, because that is where
the reader arrives from.

### 5.1 `SystemSaturated` — runs are waiting over 30 s to start

**Means:** claim latency p95 > 30 s for 5 minutes. Runs are queued and no worker is
free. Users see queued runs with growing ETAs.

1. `GET /api/status` → is `slotsAvailable` zero?
2. **Zero:** the fleet is full. Scale replicas
   (`powershell -File scripts/load/start-replicas.ps1 -Count 3`, or Railway replica
   count). Per-tenant limits are enforced from shared state and are unaffected by the
   replica count — proven in CAPACITY.md §4.
3. **Non-zero while latency is high:** the claim query itself is slow, not the fleet.
   Check `db_pool_wait_seconds` p95. Rising means the connection pool is the
   bottleneck; look for a tenant-DB node holding connections.
4. **Check for one abusive tenant** on the Fleet Health dashboard's queue-depth panel,
   split by workspace. Fairness bounds their impact but does not stop them filling the
   queue.

**Do not** raise pool sizes to fix this. Pool size is a memory decision; this is an
arrival-rate problem.

### 5.2 `WorkersDyingOrOverloaded` — lease expiry over 1/min

**Means:** workers holding runs stopped heartbeating. Either crashing, being OOM-killed,
or too loaded to renew every 10 s.

1. `jvm_heap_used_bytes` vs `jvm_heap_max_bytes` → at the ceiling means OOM. Measured
   peak under 1,550 queued runs was 109 MB against 1 GB, so a heap near the ceiling
   indicates a payload problem, not normal load.
2. `thread_blocked_seconds` by pool → a worker stuck on outbound I/O.
3. Container restart count confirms crashes.
4. **Runs are not lost.** An expired lease is reclaimed by `CrashRecoveryLoop` and the
   run resumes from its last checkpoint. Verify with the run detail's Ribbon; the
   continuation shows as one logical run.

### 5.3 `DeadLetterNeedsAttention` — a poison job

**Means:** a job exhausted its retries. Retrying did not help and will not.

1. `GET /api/dead-letters` → read the payload and the failure reason.
2. Fix the cause or discard the job. **This does not resolve itself.**
3. If several arrive at once, look for a common connection or workflow version — a bad
   publish looks like many poison jobs.

### 5.4 A tenant's database hangs

**Means:** one workspace's `db_query` nodes stop returning. No alert fires, by design —
it is contained.

**Measured containment** (CAPACITY.md §3.2): the hanging tenant consumed **1 of 16**
dispatcher threads; ten unrelated tenants ran at a p50 wait of 10 ms and all succeeded.

1. Confirm containment: `tenant_db_slots_active` should be well below its total.
2. The tenant's runs fail on socket timeout after `DB_SOCKET_TIMEOUT_SECONDS` (30 s).
3. Tell the customer their database is not responding. This is their outage, not yours.
4. **Escalate only if** `tenant_db_queue_depth` is climbing — that means multiple
   tenants are affected and the isolation assumption needs re-checking.

### 5.5 A replica dies mid-demo

1. At N≥2 nothing to do; work continues on the remaining replicas. Throughput drops
   proportionally, wait times rise.
2. At N=1 the platform stops until the replica restarts. In-flight runs resume from
   checkpoints; nothing is lost.
3. **Run demos at N≥2.** This is the entire reason.

---

## 6. Known limitations, with fixes and dates

Stated because someone will ask, and having an answer ready is worth more than the
limitation costs.

| Limitation | Impact | Fix | Target |
|---|---|---|---|
| Alerts deliver nowhere (§2) | Monitoring is a dashboard, not alerting | 4 env vars + a smoke test | Before first customer |
| Rollback untested (§3) | Unknown recovery from a bad deploy | Staging rehearsal | Before first customer |
| PITR restore unverified (§4) | Backups are a setting, not a backup | One restore to a branch | Within 30 days |
| No ceiling found (CAPACITY §3.4) | "3.4 runs/s" is a service rate, not a proven max | Load generator on a separate host | With Hetzner move |
| Provider 429 path unexercised (D18, D36) | The guard most likely to matter is untested | 429 mode on the mock | Next reliability change |
| Repair retry not driven from executor (D29/D30) | Schema violations retry with the same prompt | Executor attempt loop | Next reliability change |
| Agent nodes lack Layer 0/2 (D28/D31) | Intermediate agent turns are unconstrained | Thread schema through agent loop | With agent-loop work |
| All numbers from a laptop (CAPACITY §2) | Not the target topology | Re-measure on Hetzner + Neon | Before quoting externally |

### What to say if asked "is it production ready?"

The durability and fairness properties are measured and hold: no lost runs, no duplicate
side effects, per-tenant isolation under a 25× flood, and containment of a hanging tenant
database. Those are the hard parts and they are done.

The operational readiness is not: alerts do not reach anyone, and neither rollback nor
restore has been rehearsed. Those are hours of work, not weeks — but they are hours that
have not happened yet, and claiming otherwise is how the first real incident becomes the
first real data loss.
