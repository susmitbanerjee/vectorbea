# Grafana + OpenTelemetry Setup — Vectorbea

All services emit traces, metrics, and logs via OpenTelemetry OTLP.
Grafana Cloud or a self-hosted Grafana stack receives this data.

## 1. Create Grafana Account

Option A — Grafana Cloud (recommended for production):
1. Create account at https://grafana.com/auth/sign-up
2. Create a new stack (free tier available)
3. Go to "My Account" → "Send Metrics" → copy OTLP endpoint and API key

Option B — Self-host:
```
docker run -d -p 3000:3000 grafana/grafana-oss
# Configure Prometheus + Tempo + Loki datasources
```

## 2. Required Environment Variables

Set on **api-kotlin**, **worker-kotlin**, and **telemetry** services:

```env
OTEL_ENABLED=true
OTEL_SERVICE_NAME=vectorbea-api          # or vectorbea-worker / vectorbea-telemetry
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64(instanceId:apiKey)>
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=prod,service.version=0.1.0
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp
VECTORBEA_ENV=prod
```

For local dev:
```env
OTEL_ENABLED=false   # disable locally — service still works
```

## 3. Service Names

| Service           | OTEL_SERVICE_NAME          |
|-------------------|----------------------------|
| api-kotlin        | vectorbea-api              |
| worker-kotlin     | vectorbea-worker           |
| telemetry         | vectorbea-telemetry        |

## 4. Dashboard Panels

### API Dashboard (`vectorbea-api-dashboard.json`)
- Request rate (req/s) — `rate(api_request_count_total[5m])`
- Error rate — `rate(api_error_count_total[5m]) / rate(api_request_count_total[5m])`
- p50 / p95 / p99 latency — histogram_quantile on `api_request_duration`
- Requests by route — grouped by `http.route`
- Active SSE connections — `sse_connections_current`

### Worker Dashboard (`vectorbea-worker-dashboard.json`)
- Active tasks — `worker_active_tasks`
- Job duration p95 — histogram_quantile on `worker_job_duration`
- Workflow run success/fail rate
- LLM call count + duration
- Tool call count + error rate
- Queue depth — `queue_depth_current`

### Queue Dashboard (`vectorbea-queue-dashboard.json`)
- Redis Streams pending messages — `queue_pending_current`
- Consumer lag
- Queue depth over time

### LLM + Tool Dashboard (`vectorbea-llm-tool-dashboard.json`)
- LLM call rate — `rate(llm_call_count_total[5m])`
- LLM token usage — `sum(llm_tokens_total)`
- LLM error rate
- Tool call rate / error rate
- Tool call duration p95

### System Overview (`vectorbea-system-overview.json`)
- All services status (api + worker + telemetry)
- DB latency — `db_query_duration_p95`
- Redis latency — `redis_command_duration_p95`
- Total workflow runs / simulations / real executions
- Beta access denied count
- Usage limit blocks

## 5. Alerts

Configure in Grafana Alerting:

| Alert                         | Condition                                    |
|-------------------------------|----------------------------------------------|
| API error rate high           | error_rate > 5% for 5 minutes               |
| Worker heartbeat missing      | No heartbeat event for 2 minutes            |
| Queue depth high              | queue_depth > 1000 for 10 minutes           |
| Redis latency high            | redis_p99_ms > 100 for 5 minutes            |
| DB latency high               | db_p99_ms > 500 for 5 minutes               |
| Run failure rate high         | workflow_run_failure_rate > 20% for 5m      |
| Usage limit spike             | usage_limit_blocked_rate > 50/min           |
| Connection test failures      | connection_test_failure_rate > 30% for 5m   |

## 6. Filtering by Environment

All spans include `deployment.environment` attribute set from `VECTORBEA_ENV`.

In Grafana, filter panels by:
```
{deployment_environment="prod"}
```

Separate dashboards or variables can be used for dev / stage / prod.

## 7. Instrumented Spans

### api-kotlin
- `http.request` — all API requests
- `db.query` — all DB queries
- `redis.command` — Redis operations
- `jwt.verify` — auth checks
- `connection.test` — connection testing
- `architect.plan` — AI Architect planning
- `run.trigger` — workflow run trigger
- `sse.stream` — SSE streaming events

### worker-kotlin
- `job.consume` — queue job consumption
- `run.execute` — full run execution
- `node.execute` — individual node execution
- `llm.call` — LLM API calls
- `tool.call.http` — HTTP tool calls
- `tool.call.db` — DB tool calls
- `checkpoint.write` — state checkpoint writes
- `event.append` — run event appends
- `redis.publish` — pub/sub events
- `recovery.incident` — failure incident creation

### telemetry service
- `ingestion.request` — analytics event ingestion
- `dashboard.query` — dashboard API queries
- `rollup.job` — daily rollup computation

## 8. Metrics List

```
api.request.count         (counter)
api.request.duration      (histogram, ms)
api.error.count           (counter)
worker.job.count          (counter)
worker.job.duration       (histogram, ms)
workflow.run.count        (counter, labels: status=success|failed|cancelled)
workflow.run.duration     (histogram, ms)
workflow.step.duration    (histogram, ms)
llm.call.count            (counter)
llm.call.duration         (histogram, ms)
llm.tokens                (counter, labels: direction=input|output)
tool.call.count           (counter)
tool.call.duration        (histogram, ms)
db.query.duration         (histogram, ms)
redis.command.duration    (histogram, ms)
queue.depth               (gauge)
queue.pending             (gauge)
sse.connections           (gauge)
beta.access.denied        (counter)
usage.limit.blocked       (counter)
```
