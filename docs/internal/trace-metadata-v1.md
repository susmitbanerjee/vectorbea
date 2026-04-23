# Trace Metadata v1 (`audit_logs.metadata`)

`audit_logs` remains the execution source of truth.  
Each row is one trace. `audit_logs.metadata` is the structured trace envelope.

Important: the Trace product surface is runtime-only. Generic UI/admin audits may still share `audit_logs`, but they must be tagged as `use_type: "audit"` and excluded from Trace list/detail, replay, compare, and evaluation workflows.

## Canonical envelope

Every new write should include:

- `schema_version: "1.0"`
- `trace`
- `executor`
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

## Executor-aware execution

`executor` records where the resolved prompt was executed:

- `type`: `direct_provider`, `enterprise_gateway`, or `observe_only`
- `name`: provider or gateway name
- `ownership`: `vectorbea` or `customer`
- `request_mode`: `direct`, `forwarded`, or `wrapped`
- `endpoint`: provider endpoint label or customer gateway path
- `response_observability`: `full`, `partial`, or `minimal`

VectorBea resolves prompt identity, version, and variables before dispatching to the executor. Enterprise gateway mode forwards the resolved payload to the customer gateway while preserving VectorBea lineage, trace metadata, and replay/audit behavior.

Direct-provider mode is compatibility-preserving in this repository. It keeps existing direct-provider traces and replay plumbing readable, but the fully real network execution path is enterprise-gateway-ready when gateway configuration is provided.

## Compare and replay evaluation

Trace comparison is built directly on `audit_logs`: the compare view loads two audit rows, normalizes their `metadata`, and computes diffs for prompt version, executor path, observability, output, latency, tokens, and cost. Missing gateway fields are shown as unavailable rather than coerced to zero.

Replay evaluation is a lightweight rule-based MVP. It compares a replayed trace against its source trace and persists the result on the replayed row under `metadata.evaluation`:

- `score`: normalized score from available checks
- `label`: `better`, `same`, `worse`, `pass`, `fail`, or `unknown`
- `compared_against_trace_id`: source trace id
- `evaluation_mode`: `replay_compare`
- `checks`: status, latency, token usage when available, output availability, and observability notes

This is intentionally not an LLM judge yet. It gives engineers an immediate debug -> replay -> compare -> evaluate loop while keeping enterprise gateway execution honest about partial observability.

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

## Runtime trace identification

Runtime traces are identified in this order:

- `tags.use_type === "runtime"`
- `trace.kind === "runtime_execution"` or `tags.trace_kind === "runtime_execution"`
- executor metadata present
- replay lineage present
- real execution spans or final output present

Rows tagged `use_type: "audit"` or `trace.kind: "admin_audit"` are not runtime traces and must never appear in the TraceLoop, replay, compare, or trace-set evaluation product surfaces.

## TraceLoop terminology

The primary trace timeline UI is now called `TraceLoop` in the product. Older internal names may still use `waterfall` for implementation compatibility, but user-facing labels should use `TraceLoop`.

## Trace-set evaluations

Trace-set evaluations replay a selected set of runtime traces against a candidate prompt version using the same prompt-resolution-first executor path. The resulting replay traces remain runtime traces. The evaluation run record itself is stored as an audit-classified row and must not pollute the Trace product surface.

## UI consumption notes

- Status: prefer `metadata.trace.status`.
- Cache: prefer `metadata.cache.status`.
- Model/provider: prefer `metadata.model`.
- Executor: prefer `metadata.executor`.
- Prompt/version variables: prefer `metadata.prompt`.
- Input/output/logs/spans: read from canonical sections when available.
- If spans are missing, UI synthesizes baseline spans from proxy/LLM latency.
