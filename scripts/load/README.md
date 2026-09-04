# Load harness

Measures what a tenant actually experiences — wait before start, throughput,
fairness, and whether one tenant's broken dependency degrades the others.

Everything upstream is mocked, so a full run costs nothing and works offline.
No real LLM provider, tool endpoint, or tenant database is ever contacted.

---

## What it measures

| Metric | Source | Why it is the right number |
|---|---|---|
| Throughput | `agent_runs` terminal states ÷ wall clock | Counts finished work, not dispatched work |
| Wait before start p50/p95/p99 | `XADD` stream ID → `RUN_STARTED` in `run_events` | The latency between pressing Run and the run beginning — the only queue number a user can feel |
| Per-tenant fairness | best-served ÷ worst-served completed count | A ratio of 1.0 is fair; `∞` means a tenant completed nothing |
| Peak PEL depth | `worker_pel_depth` sampled at 4 Hz | Messages this worker holds unacked. No other worker can take them until the idle threshold expires, so depth is head-of-line blocking made visible |

The stream message ID doubles as the enqueue timestamp (Redis assigns
`<millis>-<seq>` at `XADD`), so wait-before-start is exact and needs no extra
field on the message.

---

## Workload shapes

| Shape | Nodes | Class the classifier derives | Purpose |
|---|---|---|---|
| `linear-5-step` | 5 × transform | SHORT | Pure CPU. Isolates scheduling cost from I/O |
| `agent-iterative-8-turn` | 8 × llm | AGENT | Eight sequential LLM calls. Holds one AGENT slot for 8 × latency |
| `parallel-fanout-8` | parallel → 8 × http → join | LONG | Concurrency inside a single run |
| `tool-slow-30s` | 1 × http → `/tool/slow` | LONG | A well-behaved but slow dependency |
| `tool-stall` | 1 × http → `/tool/stall` | LONG | Headers arrive, body never does. The shape `HttpRequest.timeout()` cannot catch |
| `tenant-db-hang` | 1 × db_query → black hole | LONG | TCP accepted, nothing ever answered. The unbounded case |

Classes are not declared — they are derived by `JobClassifier` from the graph
JSON, exactly as in production. `expectedClass` in `shapes.mjs` records what the
heuristic should produce so a shape cannot silently migrate between pools.

---

## Running it

### 1. Infrastructure

```bash
docker compose -f scripts/load/docker-compose.load.yml up -d
```

Postgres on **15432**, Redis on **16379** — deliberately not the dev ports, so a
load run cannot touch a local dev database.

### 2. Schema

```bash
node scripts/load/migrate.mjs
```

Applies the API's real Flyway migrations, so the harness runs against the
production schema rather than an approximation.

### 3. Mock upstreams

```bash
node scripts/load/mock-upstreams.mjs --port 18080
```

```bash
node scripts/load/hang-db.mjs --port 15433
```

`mock-upstreams` serves OpenAI- and Anthropic-shaped LLM endpoints plus tool
routes, each with configurable latency (`--llm-latency`, `--tool-latency`,
`--slow-latency`, or per-request `?ms=`).

`hang-db` accepts TCP connections and never answers — the failure the timeout
audit exists for. Note that this is **not** "the host is down": a refused
connection fails in milliseconds and is harmless. The dangerous shape is the
handshake that completes and then goes silent.

### 4. Worker

```bash
node scripts/load/worker-env.mjs --print
```

prints the exact environment the worker needs. Then, from `apps/worker-kotlin`:

```bash
node ../../scripts/load/worker-env.mjs --exec gradle run
```

Metrics land on **19090** so they do not collide with a local worker.

### 5. Scenarios

```bash
node scripts/load/run.mjs --all --out docs/architecture/LOAD-BASELINE.md
```

```bash
node scripts/load/run.mjs --scenario 5
```

---

## Scenarios

1. **1 tenant, 1 agent workflow** — baseline; wait is pure dispatch latency.
2. **3 tenants × 1 agent workflow** — saturation at 2 agent slots.
3. **10 tenants × 1 agent workflow** — how far behind the tenth tenant falls.
4. **1 tenant floods 50 short runs + 5 tenants × 1** — fairness under load.
5. **1 tenant with a hanging DB + 5 normal tenants** — the critical test.

---

## Scheduler checks (Stage 6b)

Four focused scripts, each answering one question about the Postgres-claim
scheduler. All assume infrastructure, mocks and at least one worker are already
running. Full results in `docs/architecture/POSTGRES-CLAIM.md`.

```bash
# FIFO vs weighted fair queueing, same worker, one variable changed
node scripts/load/fairness-compare.mjs

# Claim round-trip percentiles + whether LISTEN is actually delivering
node scripts/load/claim-latency.mjs [port ...]

# Does the priority lane preempt a saturated pool?
PRIORITY_FLOOD=40 node scripts/load/priority-lane.mjs

# Can a run execute twice while both transports are live?
node scripts/load/dual-mode-check.mjs
```

### Assert the worker count first

`replicas.sh stop` only knows the pids it started itself, so a worker launched
directly by `start-worker.sh` survives it and the next start adds another. Stray
workers do not look like an error — they look like a broken per-tenant limit,
because each one has its own permits. Three Stage 6b measurements were wrong for
exactly this reason before anyone counted the processes (see TECH-DEBT D14).

Before trusting any number that mentions a limit:

```bash
powershell.exe -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { \$_.CommandLine -like '*worker-kotlin*' }).Count"
```

### Which mode the harness enqueues in

| Variable | Effect |
|---|---|
| `LOAD_QUEUE_MODE=postgres` | Row only — no XADD. Matches API `QUEUE_MODE=postgres`. |
| *(unset)* | Row **and** XADD. Matches API `QUEUE_MODE=dual`. |
| `LOAD_FAIR_ORDERING=false` | Stamp `fair_vtime = now`, degrading the claim to arrival order. The FIFO control. |
| `LOAD_USE_LEGACY_STREAM=true` | Route onto the old untyped stream instead of the typed one. |

## The SSRF exemption

HTTP tool nodes are guarded by `SsrfGuard`, which blocks loopback and private
addresses. A mock upstream is necessarily on one of those, so the harness sets:

```
SSRF_ALLOWED_TEST_HOSTS=127.0.0.1
```

That variable is **ignored entirely when `APP_ENV=production`**, matches exact
hostnames only (no suffix or wildcard matching), and is applied after the
`localhost` / metadata-hostname block and after the per-connection allow-list.
It exempts a host from the address-range checks and nothing else.

Never set it on a deployed worker.

---

## Safety

- Separate ports and separate volumes from dev infrastructure.
- `resetLoadData` deletes only rows under workspaces slugged `loadtest-*`.
- The harness never contacts an external network endpoint.
- Secrets are AES-256-GCM encrypted with a fixed all-sevens key that protects
  nothing real; the mock accepts any API key.
