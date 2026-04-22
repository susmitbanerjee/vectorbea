# Trace Metadata v1 (`audit_logs.metadata`)

`audit_logs` remains the execution source of truth.  
Each row is one trace. `audit_logs.metadata` is the structured trace envelope.

## Canonical envelope

Every new write should include:

- `schema_version: "1.0"`
- `trace`
- `prompt`
- `model`
- `cache`
- `output`
- `spans` (array, can be empty)

Optional sections:

- `request`
- `retrieval`
- `guardrail`
- `fallback`
- `evaluation`
- `logs`
- `tags`
- `custom`

## Runtime write path

- Proxy ingest routes normalize metadata to v1 before dispatch:
  - `vectorbea-proxy/src/main/kotlin/com/vectorbee/proxy/grpc/VectorBeeGrpcService.kt`
  - `vectorbea-proxy/src/main/kotlin/com/vectorbee/proxy/http/PublicHttpServer.kt`
  - `vectorbea-proxy/src/main/kotlin/com/vectorbee/proxy/Main.kt` (`/v1/audit`)
- Control-plane insert routes also normalize to v1:
  - `vectorbea-ui/app/api/proxy/audit/batch/route.ts`
  - `vectorbea-ui/app/api/audit/batch/route.ts`
  - `vectorbea-ui/app/api/audits/route.ts`

## Backward compatibility

- Old flat metadata remains readable.
- Unknown/legacy keys are retained under `custom`.
- UI normalizes first, then falls back to `custom`:
  - `vectorbea-ui/lib/server/traces.ts`

## UI consumption notes

- Status: prefer `metadata.trace.status`.
- Cache: prefer `metadata.cache.status`.
- Model/provider: prefer `metadata.model`.
- Prompt/version variables: prefer `metadata.prompt`.
- Input/output/logs/spans: read from canonical sections when available.
- If spans are missing, UI synthesizes baseline spans from proxy/LLM latency.
