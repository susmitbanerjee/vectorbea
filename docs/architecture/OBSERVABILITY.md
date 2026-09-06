# Observability

One fewer deployed service, one shared library, one monitoring stack, three dashboards,
three alerts.

Implements §4.5 and §5.4 of `05-BACKEND-ARCHITECTURE.md`.

---

## 1. What changed

`apps/telemetry` is gone. It is now `packages/observability-kotlin`, a library that
`api-kotlin` and `worker-kotlin` both compile against.

| Before | After |
|---|---|
| 4 deployable units | **3** — api, worker, web |
| Telemetry service on its own Railway instance + domain | In-process in the API |
| 2 Flyway histories against 1 database | 1 chain (`V032__telemetry_schema.sql`) |
| 2 Counter/Gauge/Histogram implementations | 1, in the library |
| 2 `JsonLayout` classes, already diverged | 1 `JsonLogEncoder` |
| 2 `MdcKeys` objects, camelCase | 1 set of constants, snake_case |
| API POSTs analytics to itself over HTTP | Direct call, no loopback request |
| Its own Hikari pool | Borrows the host's |
| Its own `JwtVerifier` + auth middleware | The API's existing auth |

Consumed via `includeBuild`, as a real Gradle dependency — **not** vendored the way
`packages/recovery-kotlin` is. A copied library drifts, and drift in the observability
layer is uniquely bad: the whole point is that two services report the same numbers in
the same shape. They had already drifted before this change.

### The one behavioural change

The admin analytics dashboard moved:

```
GET /api/dashboard/summary        →  GET /api/admin/telemetry/summary
GET /api/dashboard/business       →  GET /api/admin/telemetry/business
GET /api/dashboard/engineering    →  GET /api/admin/telemetry/engineering
GET /api/dashboard/users          →  GET /api/admin/telemetry/users
GET /api/dashboard/revenue        →  GET /api/admin/telemetry/revenue
GET /api/dashboard/architect      →  GET /api/admin/telemetry/architect
GET /api/dashboard/workflows      →  GET /api/admin/telemetry/workflows
GET /api/dashboard/environments   →  GET /api/admin/telemetry/environments

the console at  /  →  /admin/telemetry
```

It had to. `api-kotlin` already serves `GET /api/dashboard/summary` — the product
dashboard a normal user sees on Home. Two different resources cannot share a path in
one process; whichever registered second would have been silently shadowed, and the
failure would have surfaced as a user seeing platform-wide analytics or an admin seeing
one workspace's.

**Ingestion paths did not change.** `/api/telemetry/events` and
`/internal/telemetry/events` keep their exact paths, bodies and auth model, so the web
app moves by pointing `TELEMETRY_ENDPOINT` at the API host. No client change.

### Log field names changed

The envelope is snake_case now. `runId` → `run_id`, `nodeId` → `node_id`,
`workspaceId` → `workspace_id`, and so on.

**This breaks saved log queries.** A Loki query for `runId` finds nothing after this
deploy. It was done rather than softened with a transition period emitting both keys,
which would have doubled the envelope forever to save one search-and-replace.

---

## 2. What to deploy

> **Updated 2026-09-06.** This section described a single Hetzner box and a scrape
> config that named `host.docker.internal`. The platform deploys on Railway, so none
> of it ever worked: 110 metrics were emitted into nothing and three dashboards
> rendered nothing for the whole life of the stack. See
> [`../TELEMETRY-AUDIT.md`](../TELEMETRY-AUDIT.md) §8 for how that happened.

**Deployment: [`../../ops/monitoring/railway/README.md`](../../ops/monitoring/railway/README.md).**

The shape, briefly:

- **One monitoring project**, six services, of which only Grafana
  (`telemetry.vectorbea.com`) and the central collector face the internet. Prometheus
  and Tempo have no authentication of their own and stay on the private network.
- **One agent per application environment.** Railway's private network is scoped per
  environment, so a central Prometheus genuinely cannot scrape staging's worker. The
  agent scrapes locally, stamps `environment`, and pushes out over one authenticated
  connection. The alternative — public `/metrics` — would serve
  `llm_cost_usd_micros{workspace}` to anyone who asked.
- **One Grafana for both environments**, separated by the `environment` label and an
  `$env` selector on every dashboard. Two Grafanas would mean two sets of dashboards
  to keep in step, and the question asked during an incident is "does staging look
  like this too?"

Local development:

```bash
cd ops/monitoring
export GRAFANA_ADMIN_PASSWORD='…'
docker compose up -d
```

Point the services at their environment's agent — **not** at the central stack:

```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://telemetry-agent.railway.internal:4317   # localhost:4319 locally
```

`OTEL_ENABLED` unset means spans are created and discarded with no exporter, no
batching thread and no network. That is the right default for local development, and it
is why the instrumentation sits on the hot path unconditionally instead of behind an
`if` at every call site.

### The stack

| Service | Port (localhost only) | Retention |
|---|---|---|
| Prometheus | 9091 | 15d / 4GB |
| Alertmanager | 9093 | — |
| Loki | 3100 | 15d |
| Tempo | 3200 | 72h |
| OTel Collector | 4317 / 4318 | — |
| Grafana | 3000 | — |

Everything binds to `127.0.0.1`. Prometheus has no authentication and its query API can
read every series including per-workspace cost; reach it through Grafana or an SSH
tunnel.

**Traces are kept for 72h, not 15d.** Traces are large and are used within hours of the
thing they describe. "Why was this run slow yesterday" is a real question; "why was this
run slow two weeks ago" is not, and the metric and log records survive either way.

---

## 3. The alerts — three pages, seven tickets

> **Updated 2026-09-06.** Was "three alerts, not four". The constraint was right about
> what it protected and wrong about the assumption underneath it: that every alert
> competes for the same attention. "I would not get out of bed, and I would be angry
> to find this on Monday having started on Friday" is a real category, and a dashboard
> does not cover it — nobody opens a dashboard on Saturday.
>
> So there are two severities. **The page budget is still three.** A ticket does not
> spend it.

**Pages** — production only, wake someone:

| Alert | Condition | What it means |
|---|---|---|
| `SystemSaturated` | claim latency p95 > 30s for 5m | Runs are queued and no worker is free |
| `WorkersDyingOrOverloaded` | lease expiry > 1/min for 5m | A worker died or cannot renew every 10s |
| `DeadLetterNeedsAttention` | dead letters increase over 15m | A poison job needs a person |
| `ScrapeAgentDown` | no metrics from an environment for 5m | Every dashboard is now stale data that looks like calm |

**Tickets** — email, act during the working day:

| Alert | What it means |
|---|---|
| `ScheduledJobStale` | A background loop has not succeeded in 3 of its own intervals |
| `PartitionMaintenanceFailing` | Partitions are not being created, or the drop gate cannot evaluate |
| `TelemetryDropsNonZero` | A bounded buffer filled; the `signal` label says how bad |
| `ProviderThrottlingHigh` | 429s above threshold, or one arrived post-admit |
| `WorkspaceCostAnomaly` | One workspace at 5x its own daily rate |
| `CentralIngestFailing` | The collector cannot write to Prometheus or Tempo |

`ScrapeAgentDown` is a page rather than a ticket for one reason: with no data, every
other dashboard shows stale numbers that are indistinguishable from a quiet, healthy
system. It also **inhibits** every other alert for that environment.

Every alert has a section in [`../telemetry/RUNBOOKS.md`](../telemetry/RUNBOOKS.md), and
CI fails if one does not — an alert with no documented response is noise that wakes
someone up.

**The test for adding a fourth:** would you get out of bed for it? "I'd look in the
morning" means it is a dashboard panel. "I'd want to know but there is nothing I could
do" means it is a dashboard panel with a note. Only "I would act immediately, and the
action is obvious" earns an alert.

Each alert carries its action in the notification body, because the person reading it at
3am will not reconstruct the reasoning.

`WorkersDyingOrOverloaded` inhibits `SystemSaturated` — a dying fleet makes everything
slow, and one incident should be one page.

### What is deliberately NOT alerted

- **Error rate.** A failed run is usually a user's workflow being wrong, not the
  platform. It belongs on the run-health dashboard.
- **Cost.** Spend is a weekly review, not a page.
- **Disk, CPU, memory.** Real, but they manifest as one of the three above before they
  matter. Alerting on them separately triples the volume for no extra signal.
- **The monitoring box being down.** It cannot alert on its own death. That gap needs a
  free external ping on the API's `/health` and is **not** covered by this stack.

---

## 4. The metrics

Every metric §5.4 names, verified by scraping rather than by reading code:

```bash
node scripts/load/verify-metrics.mjs
```

11 of 11 present. That harness found two real bugs on its first run:

1. **Counters declared the wrong metric family.** `# TYPE lease_expiry counter` with
   samples named `lease_expiry_total` — the declared family had no samples and the
   samples belonged to no declared family. Prometheus ingests it either way, so nothing
   surfaced; the series existed but was untyped. Five §5.4 metrics were affected.
2. **The verifier's own flaw** — it counted `le` as a real label, so an empty histogram
   read as a labelled one with wrong labels.

Renames to the §5.4 names: `claim_duration_seconds` → `job_claim_latency_seconds`,
`worker_active_tasks` → `worker_in_flight{worker_id}`,
`provider_throttle_suspend` → `provider_429_total`.

New: `job_queue_depth{workspace,priority}`,
`job_execution_duration_seconds{node_kind,outcome}`, `db_pool_wait_seconds`,
`run_suspended_total{reason}`, `worker_slots_available`, and the three cost counters.

`db_pool_wait_seconds` comes from a `TimedDataSource` wrapper rather than from
instrumented call sites. There are over a hundred `dataSource.connection` sites; a
wrapper is the only place that sees every acquisition, including Flyway's and the
analytics library's.

### Cardinality

`llm_cost_usd_micros{workspace,workflow,model}` is the highest-cardinality metric in the
process, and it is accepted rather than avoided: "which customer is costing me money"
cannot be answered by an aggregate. `LabelGuard` caps every metric at 1,000 distinct
label sets and collapses the rest into `overflow`, so the failure mode is a dashboard
that stops distinguishing the long tail, not a worker that runs out of memory.

If that cap is reached, drop `workflow` from the labels and read per-workflow cost from
`agent_runs.estimated_cost_usd`, where it already lives and where cardinality is free.

---

## 5. Tracing across the queue

In-process tracing is easy — the context is ambient. The moment work crosses a queue the
parent is in a different process that has already returned, and the trace breaks exactly
where it becomes interesting: *the user pressed Run at 09:41 and the node started at
09:46, where were those five minutes?*

So the W3C traceparent is written into the job payload at enqueue and extracted at
claim. The queue carries the trace as data, the same way it carries the run id.

```
API request (SERVER)
└── enqueue                      ← traceparent written into the job fields
    └── run.start_run (CONSUMER) ← extracted at claim, in the worker
        ├── node.llm
        │   └── the model call
        ├── node.transform
        └── node.http
```

Parent-child rather than a span link: the claim genuinely *is* caused by the enqueue.
Links are for fan-in.

`spanSuspending` exists separately from `span` because `Span.makeCurrent()` returns a
thread-local Scope that must be closed on the thread that opened it. A coroutine can
resume anywhere, so the thread-local form around a suspending block attributes
everything after the first suspension to whatever span is current on the resuming
thread — usually none. That failure is invisible: the span exists, has a duration, and
is simply missing its children.

Logs and traces are linked in both directions. `trace_id` is in the log envelope, so
Grafana turns it into a link to the trace, and Tempo links back to the logs emitted
inside a span. Following a spike from a graph to the logs to the slow span without
typing an identifier is the difference between five minutes and an hour.

---

## 6. When to split telemetry back out

The consolidation is right *now*. Here is what would make it wrong, in measurable form.

### Trigger 1 — more than one engineer

Specifically: **a second person who ships to the API without reading the analytics
code.**

The cost of one deployable is that a bad analytics query can slow the API for everyone.
Today that risk is managed by one person holding both in their head. With two, the
coupling stops being free — a change to ingestion becomes a change to the API's release,
and every analytics deploy carries the API's risk.

*Measurable form:* more than one person has merged to `apps/api-kotlin` in the last
30 days.

### Trigger 2 — telemetry volume competes with the hot path

Analytics now shares the API's Hikari pool. That is deliberate: it makes the cost
visible instead of hiding it in a second pool that only surfaces when Postgres starts
refusing connections. It also means a burst of events competes with a user's request for
a connection.

*Measurable form, any one of:*

- `db_pool_wait_seconds` p95 on the API above **50ms** for an hour — connections are
  contended, and ingestion is a plausible cause.
- `analytics_events` inserts above **50/s** sustained. At that rate the write volume is
  no longer noise against run traffic.
- The `analytics_events` table above **50M rows**, where the dashboard queries start
  needing their own read replica.

### Trigger 3 — a different availability requirement

If analytics ingestion ever needs to keep accepting events while the API is being
deployed — a real requirement if events start driving billing rather than curiosity —
they need separate lifecycles. Today an event lost during a 30-second deploy costs
nothing.

*Measurable form:* analytics data becomes an input to an invoice or an SLA.

### What splitting back out would take

Roughly a day, and it is deliberately cheap:

1. New `apps/telemetry` with a `Main` that starts an HTTP server.
2. Depend on `packages/observability-kotlin` — **the analytics code does not move
   again**, it is already a library.
3. Move `TelemetryRoutes` and `AdminConsoleRoutes` across.
4. Point `TELEMETRY_ENDPOINT` back at the new host; `TelemetryClient.fromEnv()` still
   exists for exactly this.
5. Move `V032__telemetry_schema.sql` to its own chain, or leave it — the tables are
   independent.

The library boundary is what makes this reversible. That is the point of doing the fold
as "extract a library, then delete a service" rather than "paste the service into the
API".

---

## 7. Known gaps

*Reviewed 2026-09-06. Gaps closed by the Railway migration are struck through; the rest
stand, and two are new.*

- **`provider_429_total` labels are unconfirmed.** The series exists and is scraped; the
  `provider` label only materialises when a provider actually returns a 429, which has
  not happened under test. Verified by inspection of the call site, not by observation.
- **The monitoring stack has no monitoring.** Still true, and still the most important
  gap here. `ScrapeAgentDown` covers an environment going dark, and `CentralIngestFailing`
  covers the backends refusing writes — but neither can fire if the stack itself is
  down, because Alertmanager is in it. **This needs a free external ping on the API's
  `/health` and on Grafana's port, and that is not part of any config in this repo.**
- **NEW — logs are not shipped on Railway.** Promtail reads the Docker socket and
  Railway does not expose one, so Loki receives nothing in staging or production. It
  works locally, which is the worst shape for a gap to have. The Run health "Recent
  failures" panel is empty as a result, and its description says so. Closing it means a
  Railway log drain into a Loki push endpoint.
- **NEW — the agents layer emits no metrics at all.** `worker/agents/**` — brain,
  budget, context, orchestration, tools — contains zero metric call sites, so iterations
  to completion, delegation depth, handoff loops, budget clamps, context truncations and
  approval wait times are all unmeasured. This is the largest remaining instrumentation
  gap and the layer the product is named after. See
  [`../TELEMETRY-AUDIT.md`](../TELEMETRY-AUDIT.md) §6.
- **Run failures are not labelled by class.** `FailureTaxonomy` defines ten classes each
  with a named owner, and it is already computed on every failure — but no metric
  carries it, so "root-cause distribution by owner" cannot be asked. This is the
  cheapest remaining win in the audit.
- **The API still has two metric registries** — its own, predating this library, and the
  shared one. Both are rendered by `/metrics`. Migrating the rest is D35.
- **Some `toJson` calls may still write stored payloads.** D33 fixed the confidence
  routes; the wider audit is not done.
