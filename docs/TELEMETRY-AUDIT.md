# Telemetry audit — what exists before we build anything

Written 2026-09-06, against `dev` @ 9c7aaa2. Every claim below is from the code, with a
path so it can be re-checked. Where a document and the code disagree, the code wins and
the disagreement is called out.

This is the evidence half of the decision. The recommendation is §9.

> **Status, 2026-09-06: Option B was confirmed and is implemented.** The findings below
> are kept as the point-in-time evidence that produced the decision — they describe the
> state *before* the work, and several are now closed. What shipped:
>
> - Deployment: [`../ops/monitoring/railway/README.md`](../ops/monitoring/railway/README.md)
> - Alert responses: [`telemetry/RUNBOOKS.md`](telemetry/RUNBOOKS.md)
> - Signal model: [`telemetry/grafana-opentelemetry-setup.md`](telemetry/grafana-opentelemetry-setup.md)
>
> Closed: §8 (the stack now deploys on Railway with per-environment agents), §7 (all
> nine scheduled loops publish `job_last_success_timestamp_seconds`), §11 (every listed
> document corrected). Eight dashboards, ten alerts, and CI validation of all of it.
>
> **Still open, and unchanged by this work:** the agents layer emits no metrics (§6), run
> failures are not labelled by `FailureTaxonomy` class (§6), payload-store and archive
> are uninstrumented (§6), and logs are not shipped on Railway.

---

## 1. The headline

There is no single "telemetry app". There are **three separate telemetry systems**, with
three different signals, three different stores, three different audiences, and three
different degrees of readiness. Most of what a build brief would ask for already exists.

| | Product analytics | Runtime metrics | Run traces |
|---|---|---|---|
| Signal | Discrete product events | Prometheus counters/gauges/histograms | OTel spans |
| Emitted by | web, api, worker | api, worker | worker |
| Transport | HTTP POST, JSON | `/metrics` scrape, text exposition | OTLP http/protobuf |
| Store | Postgres `analytics_events` | Prometheus TSDB | Tempo (ours) / customer's backend |
| Audience | **Internal** (platform admins) | **Internal** (operators) | **Both**, on two separate paths |
| State | Live in production | Emitted, **probably not scraped anywhere** | Shipped (P13) |

The important correction to the premise: **the thing called "the telemetry app" is not an
OTel-integrated system and never ingested metrics or traces.** It is a product-analytics
event store. OTel and Prometheus are separate layers that grew beside it.

---

## 2. Where the telemetry app actually lives

`apps/telemetry` **no longer exists.** `git ls-files apps/telemetry` returns nothing, and
it is absent from `settings.gradle.kts`. It was folded into `api-kotlin`:

- Routes — `apps/api-kotlin/src/main/kotlin/com/vectorbea/api/telemetry/TelemetryRoutes.kt`
- Console — `apps/api-kotlin/src/main/resources/static/admin-telemetry/{index.html,app.js,styles.css}`
- Engine — `packages/observability-kotlin/src/main/kotlin/com/vectorbea/observability/analytics/**`
- Schema — `V032__telemetry_schema.sql`

The fold is documented in `docs/architecture/OBSERVABILITY.md` and in the header comment
of `TelemetryRoutes.kt`, which is worth reading: the admin routes had to move from
`/api/dashboard/*` to `/api/admin/telemetry/*` because `api-kotlin` already served
`/api/dashboard/summary` for the *product* dashboard, and a first-wins router would have
silently shadowed one with the other.

**Stale docs to fix:** `docs/deployment/dev-staging-prod.md` still lists a
`telemetry.vectorbea.com` Railway service, and `docs/telemetry/deployment.md` describes
deploying it. There is no `apps/telemetry/railway.json`; only `api-kotlin` and
`worker-kotlin` have one.

---

## 3. Q1 — What does it ingest, query and render?

### Ingests: product events only

`POST /api/telemetry/events` (user session) and `POST /internal/telemetry/events`
(service-to-service, `X-Telemetry-Token`, constant-time compared). Both land in
`analytics_events` (`V032__telemetry_schema.sql:26`) — a wide row with `event_name`,
`event_category`, `occurred_at`, and pre-extracted foreign keys for workspace, user,
workflow, run, agent, tool, connection and architect session, plus `properties_json`.

The event vocabulary is a **closed whitelist** in
`packages/observability-kotlin/.../events/TelemetryEventType.kt` — 16 categories
(`BETA`, `ONBOARDING`, `ARCHITECT`, `WORKFLOW`, `RUN`, `CONNECTION`, `AGENT`, `TOOL`,
`SIMULATION`, `REAL_EXECUTION`, `APPROVAL`, `RECOVERY`, `USAGE_LIMIT`, `USER`,
`WORKSPACE`, `REVENUE_FUTURE`) with an explicit name set per category. A name not on the
list is **rejected at ingest**, which has bitten before.

It does **not** ingest metrics. It does **not** ingest traces. It does not ingest logs.

### Queries and renders

Eight admin endpoints (`TelemetryRoutes.register`), all filtered by
`environment` ∈ {dev, stage, prod} + date range + optional workspace:

`summary`, `business`, `engineering`, `users`, `revenue`, `architect`, `workflows`,
`environments`.

Rendering capability, in the static console:

- **Counts and rollups** — `analytics_daily_rollups`, `businessSummary`, `userSummary`
- **One time series** — `dailyActivity`, a stacked per-day per-category SVG on Overview
- **Funnels** — onboarding, architect
- **Top-N tables** — `topEvents`
- **Side-by-side environment comparison** — fixed 7-day window

What it **cannot** do, and this is the decisive limit:

- **No histograms and no percentiles.** There is no bucketed type in the schema; every
  number is a count or a sum. p50/p99 of anything is not expressible.
- **No trace-linked views.** `analytics_events` has `run_id` but no `trace_id` or
  `span_id` column. There is no join to a span anywhere.
- **No arbitrary time series.** `dailyActivity` is per-day per-category and that is the
  only shape. No rate, no window function, no ad-hoc query.
- **Revenue is deliberately inert** — the endpoint returns
  `monetizationEnabled: false` with a static explanation. Schema scaffolded, empty.

`engineeringSnapshot` already concedes the point in code:

> `// The fleet and run dashboards live in Grafana now; this points there rather than reimplementing them against Postgres.`

It returns a `grafanaUrl` from the environment. **The decision to not build ops
dashboards in this app was already made, in this repo.**

---

## 4. Q2 — Customer-facing or internal?

**Internal, and correctly separated already.** The brief's concern is real in general but
does not currently apply; the separation is enforced in three places.

1. **The admin console is admin-gated.** `TelemetryRoutes.admin()` requires
   `principal.isPlatformAdmin || config.isAdmin(p.email)` (`ADMIN_EMAILS`). Everything
   under `/api/admin/telemetry/*` and the static console is behind it. It is
   cross-workspace by design — that is why it is gated.
2. **The one customer-facing surface is ingest, not read.** `POST /api/telemetry/events`
   lets a signed-in user report *their own* client events. No user-facing read path
   exists over `analytics_events`.
3. **Traces are split by destination, not by filter.** This is the strongest bit of the
   existing design and it is worth not undoing. `V049__workspace_otel_exports.sql` gives
   each workspace its own OTLP endpoint, and its header comment states the rule
   explicitly:

   > *"this is SEPARATE from `Tracing.init`'s process-level OTEL_* variables, which
   > instrument the worker itself … Two different audiences, two different destinations;
   > merging them would put our infrastructure spans in a customer's Tempo."*

   A workspace with no row exports nothing. Auth headers are a `SecretService` ref, never
   plaintext.

**The one thing to keep an eye on:** the internal admin console is *served from the
customer-facing API process*, at `api.vectorbea.com/admin/telemetry`. That is a shared
blast radius, not a leak — auth is enforced per-route — but it means an authz bug in the
API is also an analytics breach. Accepted, and noted in `OBSERVABILITY.md §6` as one of
the triggers for splitting telemetry back out.

**Conclusion: internal SRE dashboards do not belong in the admin console, and they are
not in it.** They belong in the ops stack. The distinction the brief asks us to protect
is already the architecture.

---

## 5. Q3 — Do we emit OTel metrics, or only spans?

**Spans only. Definitively, and by explicit decision — not by omission.**

`packages/observability-kotlin/.../tracing/Tracing.kt:71-74`:

```kotlin
System.setProperty("otel.traces.exporter", "otlp")
System.setProperty("otel.metrics.exporter", "none")   // Prometheus scrape owns metrics
System.setProperty("otel.logs.exporter", "none")      // Loki owns logs
```

There is no `MeterProvider`, no `Meter`, and no instrument anywhere in the repo.
Corroborated downstream: `ops/monitoring/otel/config.yml` declares exactly one pipeline,
`traces`. A metrics data point sent today would be received and dropped.

So the three signals are carried on three transports:

| Signal | How | Where it lands |
|---|---|---|
| Traces | OTel SDK → OTLP → collector | Tempo (ours), or the customer's backend (P13) |
| Metrics | Hand-written Prometheus exposition → `/metrics` → scrape | Prometheus |
| Logs | `JsonLogEncoder` → stdout → Promtail | Loki |

This is a legitimate architecture and the `otel.metrics.exporter=none` comment shows it
was chosen. **It is not what the docs say.** `docs/telemetry/grafana-opentelemetry-setup.md`
opens with *"All services emit traces, metrics, and logs via OpenTelemetry OTLP"* and
instructs setting `OTEL_METRICS_EXPORTER=otlp` and `OTEL_LOGS_EXPORTER=otlp` —
environment variables that `Tracing.init` overwrites with `none` on the next line. **That
document is wrong and should be corrected or deleted**; following it produces a stack
that silently receives no metrics.

### Consequence for the choice in §9

Anything that wants our metrics must either **scrape Prometheus exposition** or we must
add a `MeterProvider`. An "OTLP-native, one deploy" product that only ingests OTLP would
mean writing an OTel metrics layer for 110 existing metrics, or running a
Prometheus-scrape sidecar anyway. That is a real cost and it weighs on the decision.

---

## 6. The metrics that already exist

**110 metrics**, hand-rolled, no client library (the reasoning is in `Primitives.kt` —
the process must never die because its metrics library threw).

- **Worker: 93** — `apps/worker-kotlin/.../metrics/WorkerMetrics.kt` (1,016 lines)
- **API: 17** — `apps/api-kotlin/.../metrics/AppMetrics.kt`

A `LabelGuard` caps every metric at 1,000 distinct label sets and collapses the rest into
an `overflow` series, so a workspace-labelled metric degrades in fidelity instead of
OOM-ing the process.

There is also a verification harness — `scripts/load/verify-metrics.mjs` — that proves
presence **by scraping the wire, not by reading the code**, because a metric can be
declared, incremented, and still never appear if it was left out of `scrape()`. It
currently asserts 11 metrics. It found two real bugs on its first run. **This harness is
the right acceptance mechanism for anything we add, and it should be extended rather
than replaced.**

### Coverage against the requested list

Legend: **✅ exists** · **◐ partial** · **❌ absent**

#### Queue and workers

| Asked for | State | Evidence |
|---|---|---|
| Depth per lane | ◐ | `job_queue_depth{workspace,priority}` — grouped by workspace and a 2-value priority bucket, **not by execution class**. `Main.kt:666` also caps at the busiest 200 workspaces. |
| Lag per lane | ✅ | `job_wait_before_start_seconds{class}` |
| Lease acquisitions | ◐ | `claimed{class}`, `claim_reserved_lane{class}`, `claim_reclaimed`; lease *acquisition* is not counted separately from claim |
| Lease expiries | ✅ | `lease_expiry{source}`, `lease_stolen`, `fenced_write{operation}` |
| Dead letters | ✅ | `dead_letter{reason}`, `resume_dead_lettered{reason}` |
| Tenant admission refusals | ✅ | `tenant_throttled{workspace,reason}`, `tenant_claim_rejected{workspace,class}`, `tenant_admission_overshoot` |
| Worker slot utilisation | ✅ | `worker_pool_slots_{total,active}`, `worker_slots_available`, `worker_in_flight{worker_id}`, `thread_blocked_seconds{pool}` |

The lane gap is small but real: five lanes exist (`ExecutionClass`: short, long, agent,
agent.child, agent.interactive, system) and depth is not broken out by them. It is one
column added to a `GROUP BY`.

#### Provider — essentially complete

| Asked for | State | Evidence |
|---|---|---|
| 429s received | ✅ | `provider_429_received{provider,model,dimension}` |
| Bucket utilisation | ✅ | `provider_capacity_utilisation{provider,model,dimension}` (ratio histogram) |
| Bucket refusals | ✅ | `provider_capacity_exhausted{provider,model,dimension}` |
| Reservations leaked / recovered by TTL | ✅ | `provider_capacity_reserved{provider,model,lane}`, `provider_capacity_leases_expired` |
| Estimate error at p95 | ✅ | `provider_estimate_error_ratio{model,shape}` |
| Circuit breaker state | ◐ | `circuit_opened` / `circuit_closed` / `circuit_rejected` as counters — **state is derivable, not directly exposed**. Deliberate: connection ids are unbounded; live state is in `connections.circuit_state`. |
| **429-after-admit counted separately** | ✅ | `provider_429_after_admit{provider,model,dimension}` — already exists, with a comment naming it a bucket bug exactly as the brief does |

This section of the brief is already built. Note the known gap in `OBSERVABILITY.md §7`:
the `provider` label on the 429 series is verified by inspection, not observation,
because no provider has returned a 429 under test.

#### Trace pipeline

| Asked for | State | Evidence |
|---|---|---|
| Spans dropped by reason | ✅ | `worker_trace_spans_dropped{reason}` (6 call sites in `SpanWriter.kt`), persisted to `agent_runs.dropped_spans` |
| Events dropped by reason | ✅ | `worker_run_events_dropped` (`RunEventStore.kt:528,572`) |
| Export failures | ✅ | `worker_trace_exports_dropped` (`RunTraceExporter.kt:129`) |
| Payload store writes | ❌ | `PayloadStore.kt` / `PayloadBlobStore.kt` — **zero metric references** |
| Payload dedupe rate | ❌ | same |
| Archive lag | ❌ | `TraceArchiver.kt` / `ArchiveStore.kt` — **zero metric references** |
| Partition maintenance | ◐ | `worker_partition_drops_gated{reason}` exists; success and lag do not |

#### Runs

| Asked for | State | Evidence |
|---|---|---|
| Success rate | ✅ | `worker_workflow_runs_{succeeded,failed,cancelled}` |
| **By failure class** | ❌ | `FailureTaxonomy.kt` defines 10 classes each with an `owner` — and **no metric carries the class as a label** |
| **Root-cause distribution by owner** | ❌ | The taxonomy is built and unused by metrics |
| p50/p99 duration | ✅ | `job_execution_duration_seconds{node_kind,outcome}`, `worker_run_duration_ms` |
| **Split working vs parked** | ❌ | `run_suspended{reason}` counts suspensions; parked *time* is not measured |
| Resume counts | ✅ | `resume_reconciled{reason}`, `resume_reconcile_failed{reason}`, `worker_run_reenqueued` |
| Reconciler recoveries | ✅ | `resume_reconciled{reason}` |

`FailureTaxonomy` is the highest-value quick win in this document: the ten-class,
owner-per-class verdict already exists and is already computed; it is simply never
attached to a counter.

#### Agents — nothing at all

`grep -c "WorkerMetrics\." apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/agents/` → **0**.

The entire agents package — `brain`, `budget`, `context`, `orchestration`, `tools` — is
uninstrumented. Every item requested is absent:

| Asked for | State |
|---|---|
| Iterations to completion vs per-agent baseline | ❌ |
| Delegation depth | ❌ |
| Handoff loops caught | ❌ |
| Budget clamps | ❌ (`run_ceiling_breach{dimension}` covers run ceilings, not per-activation clamps) |
| Context truncations | ❌ |
| Approval wait times | ❌ |

**This is the single largest gap, and it is the layer the product is named after.**

#### Cost

| Asked for | State | Evidence |
|---|---|---|
| Per workspace | ✅ | `llm_cost_usd_micros{workspace,workflow,model}` |
| Per model | ✅ | same |
| **Per run** | ◐ | Derivable from `agent_runs.estimated_cost_usd`; not a metric. `cost.json` computes cost-per-run as an aggregate ratio. |
| Ceiling hits | ✅ | `run_ceiling_breach{dimension}` |
| **Estimate vs actual (cost)** | ❌ | `provider_estimate_error_ratio` covers **tokens**, not dollars |

Micros rather than dollars, deliberately — an integer counter of fractional cents would
read 0.0 forever while real money was spent.

---

## 7. Scheduled jobs — the brief's systemic point is correct

Eight background loops run on fixed delays:

| Job | Where | Publishes last-success? |
|---|---|---|
| `RetentionSweeper` | worker | ◐ **Yes, but only to Postgres** |
| `PartitionMaintenance` | worker | ❌ |
| `ResumeReconciler` | worker | ❌ |
| `CrashRecoveryLoop` | worker | ❌ |
| `TimerScheduler` | worker | ❌ |
| `WorkerHeartbeat` | worker | ◐ `workers.last_heartbeat_at` — fleet liveness, not job success |
| `WorkflowScheduler` | api | ❌ |
| `BillingScheduler` | api | ❌ |

`RetentionSweeper` is the only one with real success tracking: a `retention_sweeps` table
with `status`/`finished_at`, surfaced by `RetentionRoutes.kt:339` as `lastSuccessAgeHours`.
**But it is a REST field, not a metric** — so nothing can alert on its staleness, and
nobody looks at a REST field they have no reason to open.

Every one of these can stop silently. `PartitionMaintenance` failing means partitions
stop being created, which surfaces weeks later as inserts landing in the default
partition. This is exactly the V028/V046 pattern the brief names.

**The fix is one shared primitive**, not eight bespoke ones: a
`job_last_success_timestamp_seconds{job}` gauge plus `job_runs_total{job,outcome}`, set
by a wrapper every loop calls. One staleness alert then covers all eight and every future
job automatically — a job that is never registered is the only remaining hole, and that
is checkable in a test.

---

## 8. Deployment reality — the decisive finding

`ops/monitoring/` is a **complete, well-reasoned, already-written stack**: Prometheus,
Alertmanager, Loki, Tempo, OTel Collector, Grafana OSS, with provisioned datasources
(including Loki↔Tempo trace correlation in both directions), 3 dashboards and 3 alerts.

It is also, on the evidence, **not running anywhere.**

- `ops/monitoring/docker-compose.yml` line 1: *"The monitoring stack for the Hetzner box."*
- `prometheus.yml` scrapes `host.docker.internal:8080` and `:9090/:9091/:9092` —
  three hard-coded worker replicas on one host.
- But the actual deployment is **Railway + Vercel + Neon** (`apps/*/railway.json`,
  `apps/web/vercel.json`, `docs/deployment/dev-staging-prod.md`). There is no Hetzner
  box in any deploy config.
- `alertmanager.yml` has no configured receiver — it still carries the placeholder
  *"CONFIGURE ONE OF THESE AND DELETE THE OTHERS."*
- `OTEL_ENABLED=false` is the documented default, so spans are created and discarded.

So: **110 metrics are emitted into nothing, 3 dashboards render nothing, and 3 alerts
fire to nobody.** The gap is not instrumentation. It is that the stack was designed for
a single-box topology the project no longer deploys on.

`host.docker.internal` is the specific blocker and it is fixable: Railway's private
network returns one AAAA answer per replica, so `dns_sd_configs` against
`worker.railway.internal` gives Prometheus the per-replica targets that
`worker_in_flight{worker_id}` needs. A load-balanced single target would round-robin and
produce nonsense — the config comment already warns about exactly this.

### What this changes about the decision

The question is **not** "which observability tool should we adopt". It is
**"where do we run the stack we already wrote, and is it cheaper to host it or to send
it to Grafana Cloud's free tier?"** That is a much smaller question, and the audit is
what makes it smaller.

---

## 9. The choice

Free tiers verified 2026-09-06 rather than taken from any list.

### Option A — Extend the existing telemetry app

**Rejected.** It has no histogram type, no percentiles, no trace linkage and no ad-hoc
query. Adding them means writing a TSDB in Postgres. The codebase already rejected this
in `engineeringSnapshot`, and it would also put internal ops dashboards inside a
product-adjacent admin surface — the mixing the brief warns against.

### Option B — Self-hosted Grafana OSS + Prometheus + Tempo + Loki

The stack is **already written and provisioned**. Licences are free (AGPLv3 for Grafana
OSS; Apache-2.0 for Prometheus, Tempo, Loki); the cost is infrastructure only.

- **Cost:** one small always-on host. A Railway service sized for it, or the €6/month
  Hetzner box the config already assumes. Call it €6–20/month.
- **Work:** replace `static_configs` with `dns_sd_configs`; deploy the compose stack;
  set `OTEL_ENABLED=true`; configure an Alertmanager receiver. Days, not weeks.
- **Against it:** one box, no replication. If it dies, the monitoring dies with it —
  `OBSERVABILITY.md §3` already names this and says an external ping is required and
  not covered. That gap is real and stays real.

### Option C — Grafana Cloud free tier

The premise that Grafana Cloud is not free is **out of date**. The current free tier is
10,000 active metric series, 50 GB logs, 50 GB traces, 14-day retention, 3 users, no card
required.

- **For it:** zero infrastructure, zero ops, and it solves the who-monitors-the-monitor
  problem outright. Same Prometheus scrape and same OTLP the stack already speaks —
  Grafana Cloud ingests Prometheus remote-write and OTLP natively, so the exposition
  format is not a barrier.
- **Against it:** 10,000 active series is the binding constraint, and this system is
  built to spend them. `llm_cost_usd_micros{workspace,workflow,model}` and
  `llm_tokens{workspace,workflow,model,direction}` are cardinality-hungry by design, and
  `LabelGuard` permits 1,000 series *per metric*. Six workspace-labelled metrics at their
  cap is 6,000 series before the other 104 metrics are counted. It fits today at a few
  dozen workspaces; it does not fit at a few hundred.
- 14-day retention is shorter than the 15d Prometheus is configured for. Traces are
  unaffected — Tempo is already set to 72h, because traces are used within hours.

### Option D — OTel-native single deploy (SigNoz, or similar)

One binary, one store (ClickHouse), metrics + traces + logs correlated in one place, and
genuinely less operational surface than four components.

**Rejected on a specific fact from §5:** it is OTLP-native, and **we do not emit OTel
metrics**. Adopting it means either writing a `MeterProvider` layer over 110 existing
hand-rolled metrics, or running a Prometheus-scrape bridge — at which point the
"single deploy" advantage is gone and we have thrown away a working, tested,
already-verified metrics layer. SigNoz's AGPL-3.0 licence also warrants a look before it
sits in a commercial product's infrastructure. Revisit only if we decide to move to OTel
metrics for their own sake.

### Recommendation — **Option B, self-hosted Grafana OSS, with a caveat**

Because:

1. **It is already written.** Three dashboards, three alerts, correlated datasources, a
   scrape config, a redacting collector pipeline and a metrics verification harness all
   exist and are good. The marginal cost of B is deployment, not construction.
2. **The metrics layer is Prometheus-shaped and staying that way.** B is the only option
   with zero impedance against §5's architecture.
3. **Cardinality is ours to spend.** The per-workspace cost metric is the whole point of
   the cost dashboard; a free tier that makes us ration it will make us drop the label,
   and then the support question the brief asks for — "what is happening with this
   customer" — becomes unanswerable.
4. **Data residency.** Metrics are labelled by workspace id and traces carry run, agent
   and step names. Keeping them on infrastructure we control avoids a customer-data
   conversation we would otherwise have to have.

**The caveat, and it is not optional:** B leaves the monitoring unmonitored. Pair it with
a free external ping on the API's `/health` **and** on Grafana's own port. This is
already written down as a known gap in `OBSERVABILITY.md §3` and has not been closed;
shipping B without closing it repeats the mistake.

**Worth reconsidering C if** the team stops wanting to run a box at all, or if
per-workspace cost gets dropped from Prometheus and read from
`agent_runs.estimated_cost_usd` instead — which `OBSERVABILITY.md §4` already names as
the fallback when `LabelGuard` bites. If that fallback is taken, series count drops
sharply and the free tier fits comfortably.

---

## 10. If Option B is confirmed, the work in dependency order

Nothing here is built yet. Rough sizes, not commitments.

**P0 — make the existing stack real** (the largest return; almost no new code)

1. `dns_sd_configs` in `prometheus.yml`; deploy the compose stack; `OTEL_ENABLED=true`.
2. Configure the Alertmanager receiver.
3. External ping on `/health` and on Grafana.
4. Fix or delete `docs/telemetry/grafana-opentelemetry-setup.md` (§5) and the stale
   `apps/telemetry` deployment docs (§2).

**P1 — the systemic fix**

5. `job_last_success_timestamp_seconds{job}` + `job_runs_total{job,outcome}` as one
   shared wrapper; register all eight loops; one staleness alert; a test that fails if a
   scheduled loop is unregistered.

**P2 — close the gaps, cheapest first**

6. `FailureTaxonomy` class + owner as labels on run outcomes (taxonomy already exists).
7. `execution_class` into the `job_queue_depth` GROUP BY.
8. Payload store writes/dedupe, archive lag, partition maintenance success.
9. Working-vs-parked duration split.
10. Cost estimate-vs-actual in dollars.

**P3 — the agents layer** (the largest new surface: iterations vs baseline, delegation
depth, handoff loops, budget clamps, context truncations, approval wait)

**P4 — dashboards 4 and 5** (provider capacity; trace pipeline health; per-workspace
support view), then alerts 4–7 with a runbook each.

Extend `scripts/load/verify-metrics.mjs` with every metric added — it asserts 11 today
and it is the mechanism that makes "every metric appears on a dashboard" checkable rather
than asserted.

---

## 11. Corrections this audit makes to existing docs

| Document | Says | Actually |
|---|---|---|
| `docs/telemetry/grafana-opentelemetry-setup.md` | All services emit metrics + logs via OTLP; set `OTEL_METRICS_EXPORTER=otlp` | `Tracing.init` hard-sets both to `none`; the collector has only a traces pipeline |
| `docs/deployment/dev-staging-prod.md` | A `telemetry` Railway service at `telemetry.vectorbea.com` | Folded into `api-kotlin`; no such service or `railway.json` |
| `docs/telemetry/deployment.md` | How to deploy `apps/telemetry` | The directory does not exist |
| `ops/monitoring/*`, `OBSERVABILITY.md §2` | Runs on "the Hetzner box" | No Hetzner box in any deploy config; the app runs on Railway |
| `OBSERVABILITY.md §7` | "The API still has two metric registries" | Correct, and the worker has a third: `WorkerMetrics.kt` duplicates `Primitives.kt` wholesale and imports nothing from `observability.metrics` |
