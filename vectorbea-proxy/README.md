# VectorBea Sidecar Proxy

The existing `vectorbea-proxy` project is VectorBea's enterprise production ingestion layer.

It is:

- Kotlin based
- GraalVM native-image ready
- published as a multi-arch Docker image for `linux/amd64` and `linux/arm64`
- capable of local localhost and UDS ingestion
- responsible for batching, retry, redaction, and fail-open transport

It is not a second ingestion system and it does not replace the VectorBea backend.

## Recommended production architecture

```text
SDK or OpenTelemetry
  -> local HTTP or UDS
VectorBea Sidecar
  -> batched forward with ingest token
VectorBea backend
  -> execution graph, workflow map, regression, safety gates, governance, ROI
```

## Integration modes

- Direct API: quick testing only
- SDK: semantic workflow instrumentation
- Sidecar: recommended enterprise production path
- OpenTelemetry: standard traces, ideally forwarded through the Sidecar

## Local ingestion

The sidecar supports local workflow telemetry ingestion over:

- `POST /v1/traces`
- `POST /v1/events`
- gRPC over the configured Unix domain socket

It also exposes:

- `GET /health`
- `GET /metrics`

## Key environment variables

Required for workflow forwarding:

- `VECTORBEA_HUB_URL`
- `VECTORBEA_KEY`
- `VECTORBEA_INGEST_URL`
- `VECTORBEA_INGEST_TOKEN`
- `VECTORBEA_SERVICE_NAME`

Common production settings:

- `VECTORBEA_SOCKET_PATH=/var/run/vectorbea/vectorbea.sock`
- `VECTORBEA_LOCAL_HTTP_PORT=8080`
- `VECTORBEA_REDACT_SECRETS=true`
- `VECTORBEA_BATCH_SIZE=50`
- `VECTORBEA_FLUSH_INTERVAL_MS=5000`
- `VECTORBEA_MAX_QUEUE_SIZE=10000`
- `VECTORBEA_FAIL_OPEN=true`

## Health response

`GET /health` reports:

- sidecar version
- queue size
- last flush timestamp
- last backend status
- events received, forwarded, failed, dropped
- redaction count

## Docker image

Published image:

- `vectorbea/vectorbea-proxy:latest`

See the main deployment guide for Docker Compose and Kubernetes sidecar examples:

- [Deployment Guide](../docs/DEPLOYMENT.md)
