# Grafana and OpenTelemetry — how the signals actually flow

> **This document was rewritten on 2026-09-06 because the previous version was wrong.**
>
> It opened with *"All services emit traces, metrics, and logs via OpenTelemetry
> OTLP"* and told you to set `OTEL_METRICS_EXPORTER=otlp` and
> `OTEL_LOGS_EXPORTER=otlp`. Neither is true, and the two variables are overwritten
> with `none` by `Tracing.init` on the next line of execution.
>
> Following it produced a stack that received no metrics and no logs, and — because a
> Grafana panel with no data looks exactly like a healthy system with nothing
> happening — reported that as success. See [`../TELEMETRY-AUDIT.md`](../TELEMETRY-AUDIT.md) §5.

## Three signals, three transports

This is the single most important thing to know before touching any of it. The platform
is **not** OTel-native. Only traces travel over OTLP.

| Signal | How it leaves the process | Where it lands |
|---|---|---|
| **Traces** | OTel SDK → OTLP → the environment's agent → central collector | Tempo |
| **Metrics** | Hand-written Prometheus text on `/metrics`, **scraped** | Prometheus |
| **Logs** | `JsonLogEncoder` → stdout | Loki (**not yet wired on Railway** — see below) |

The relevant lines, in `packages/observability-kotlin/.../tracing/Tracing.kt`:

```kotlin
System.setProperty("otel.traces.exporter", "otlp")
System.setProperty("otel.metrics.exporter", "none")   // Prometheus scrape owns metrics
System.setProperty("otel.logs.exporter", "none")      // Loki owns logs
```

These are set **in code**, unconditionally, and they override whatever you put in the
environment. That is deliberate — there is no `MeterProvider` anywhere in the repo, and
110 metrics are already emitted as Prometheus exposition — but it means the standard
`OTEL_*` exporter variables do nothing here, and setting them is misleading rather than
harmless.

**If you ever want OTel metrics**, that is a real piece of work: a `MeterProvider` plus
migrating 110 hand-rolled metrics, or a bridge. It is not an environment variable.

## What each service needs

### `api-kotlin` and `worker-kotlin`, per environment

```env
OTEL_ENABLED=true
OTEL_SERVICE_NAME=vectorbea-api          # or vectorbea-worker
OTEL_EXPORTER_OTLP_ENDPOINT=http://telemetry-agent.railway.internal:4317
OTEL_RESOURCE_ATTRIBUTES=service.version=0.1.0
VECTORBEA_ENV=prod                       # or dev
METRICS_PORT=9090                        # worker only; the API serves /metrics on 8080
```

Note the endpoint: services export to **their own environment's agent**, not to the
central stack. The agent is inside the same private network; the central stack is not
reachable from an application environment at all.

`OTEL_ENABLED` unset means spans are created and discarded — no exporter, no batching
thread, no network. That is the right default for local development, and it is why the
instrumentation sits on the hot path unconditionally rather than behind an `if` at every
call site.

### The agent, and everything else

See [`../../ops/monitoring/railway/README.md`](../../ops/monitoring/railway/README.md).
That is the deployment document; this one only explains the signal model.

## Local development

```bash
cd ops/monitoring
export GRAFANA_ADMIN_PASSWORD='…'
docker compose up -d
```

Then Grafana on <http://localhost:3000>, and point the services at the local agent:

```env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4319
```

The local compose runs a `telemetry-agent` for the same reason production does — so the
path exercised locally is the path that ships. The one difference is target discovery:
locally the agent uses static ports (`config.local.yml`), because Railway's per-replica
AAAA records have no local equivalent. Both files say so at the top.

## Logs are the remaining gap

Log shipping uses **Promtail**, which reads the Docker socket. Railway does not expose
one, so on Railway **nothing is currently shipping logs to Loki**.

Consequences, so nobody debugs this twice:

- The "Recent failures" panel on the Run health dashboard is empty on Railway. The panel
  is correct and will populate once logs arrive; its description says so.
- The Loki↔Tempo correlation in `datasources.yml` — clicking a trace and getting its
  logs — is configured and will work the moment logs land. It is not broken, it is
  unfed.
- The local compose stack **does** ship logs, because there Promtail has a Docker socket.
  So this works locally and not in production, which is the worst shape for a gap to
  have and is why it is written down here.

Closing it means a Railway log drain into a Loki push endpoint. It is not done, and
nothing else in this work depends on it.

## Verifying

```bash
# Are the metrics on the wire at all? Scrapes a live process, does not read code.
node scripts/load/verify-metrics.mjs

# Do the dashboards and alerts reference metrics that exist? Runs in CI.
node scripts/monitoring/validate.mjs
```

The first is the one that matters after a deploy. A metric can be declared,
incremented at a real call site, and still never appear on the endpoint — that is not
hypothetical, it is how five metrics behaved in this repo until the harness was
written.
