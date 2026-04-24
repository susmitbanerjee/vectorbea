# Trace Metadata v1 (`audit_logs.metadata`)

`audit_logs` is the execution source of truth.  
Each row is one trace. `audit_logs.metadata` is the structured trace envelope.

Runtime traces are produced by the VectorBea proxy and sidecar. Generic UI/admin audits share `audit_logs` but must be tagged `use_type: "audit"` and are excluded from the TraceLoop, replay, compare, and evaluation product surfaces.

---

## Timing — proxy-side capture

**Client SDKs do not need to measure LLM latency.**  
The proxy and sidecar capture all execution timing server-side:

- `proxy_latency_ms` — total proxy-side latency (prompt resolution + cache lookup + executor call + audit persist)
- `llm_latency_ms` — downstream executor call latency only (LLM or enterprise gateway)
- Both values are stored directly in `audit_logs` columns and mirrored into `metadata.model.latency_ms` and span timing

The TraceLoop renders proxy spans, cache spans, prompt-resolution spans, and executor spans from this data.  
Clients may add custom spans via the SDK's span API, but they are optional enrichment, not required for trace correctness.

---

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

Optional sections: `request`, `retrieval`, `guardrail`, `fallback`, `evaluation`, `logs`, `tags`, `custom`

---

## Executor types

`executor.type` records where the resolved prompt was executed:

- `direct_provider` — preserves existing direct-provider traces and replay behavior. Not backed by a fully real live provider engine in this repo. Replay falls back to captured output for `direct_provider` traces.
- `enterprise_gateway` — forwards the resolved payload to a customer-owned AI gateway. This is the **strongest fully-real execution path**. `VECTORBEA_ENTERPRISE_GATEWAY_URL` must be set for gateway replay to execute live.
- `observe_only` — passive observation; no execution is attempted.

`executor.response_observability` values:
- `full` — all latency, token, cost, and output data is available
- `partial` — enterprise gateway returned a response but did not report token/cost data
- `minimal` — response received but very limited telemetry
- `unknown` — observability level was not reported

---

## Runtime write path

Proxy ingest routes normalize metadata to v1 before dispatch:
- `vectorbea-proxy/.../VectorBeeGrpcService.kt`
- `vectorbea-proxy/.../PublicHttpServer.kt`
- `vectorbea-proxy/.../Main.kt` (`/v1/audit`)

Control-plane insert routes also normalize:
- `vectorbea-ui/app/api/proxy/audit/batch/route.ts`
- `vectorbea-ui/app/api/audit/batch/route.ts`
- `vectorbea-ui/app/api/audits/route.ts`

---

## TraceLoop

The primary trace timeline UI is called **TraceLoop**. It renders:
- Proxy latency span
- Cache lookup span (hit/miss/skip)
- Prompt resolution span
- Executor/LLM call span
- Output parsing span (if available)
- Custom client spans (if provided)

Spans are synthesized from `proxy_latency_ms` + `llm_latency_ms` when explicit span data is absent.

---

## Replay

Replay re-executes a runtime trace against a (potentially different) prompt version via the same executor path.  
For `enterprise_gateway` traces: live execution is performed against the gateway.  
For `direct_provider` traces: replay uses captured output (no live LLM call). This is a known limitation.

Replay timing is captured the same way as original traces — the replay executor measures latency server-side.

---

## Compare

Trace comparison loads two `audit_logs` rows, normalizes their metadata, and computes diffs for:
- Prompt version, executor path, observability level
- Output text (normalized comparison)
- Latency delta, token delta, cost delta

Missing gateway fields are shown as unavailable rather than coerced to zero.

---

## Evaluations and regression checks

Trace-set evaluations replay a selected set of runtime traces against a candidate prompt version.  
The resulting replay traces are full runtime traces. The evaluation run record is stored as an `audit`-classified row.

### Regression checks

Checks are run by `evaluateTraceReplay()` in `lib/server/trace-compare.ts`:

| Check | Category | Weight | Critical |
|---|---|---|---|
| `execution_success` | reliability | 0.22 | yes |
| `output_present` | correctness | 0.20 | yes |
| `latency_regression` | performance | 0.16 | no |
| `token_regression` | performance | 0.10 | no |
| `structured_output_valid` | structure | 0.12 | yes |
| `executor_observability` | executor_context | 0.20 | no |

Checks with `available: false` are excluded from weighted scoring. Missing data is never coerced to zero.  
Confidence is `observedWeight / configuredWeight` — low confidence means observability was incomplete, not that the run failed.

### Scoring

- `score` — weighted average of available checks (0–1)
- `confidence` — fraction of configured weight that had observable data
- `recommendation` — `ready_for_rollout | ready_with_caution | needs_review | regression_detected | blocked | inconclusive`
- Promotion requires: completed run + approved human review + no critical failures + recommendation not blocked/regression

---

## Baseline datasets

Named collections of runtime trace IDs used as repeatable inputs for evaluation runs.  
Stored in `baseline_datasets` table (not in `audit_logs`).

## Golden traces

Runtime traces explicitly marked as high-value by engineers.  
Stored in `golden_traces` table. Golden trace marking is `audit`-classified and must not appear in TraceLoop.

## Scheduled regression checks

Regression schedules pair a baseline dataset with a candidate version strategy and run evaluation runs on demand or via external trigger.  
Stored in `regression_schedules` table.  
**Built-in regression runner exists.** Enabled schedules run when due in the app runtime; `POST /api/evaluations/regression-schedules/[id]/run` remains available for Run now and operational triggers.

---

## Known limitations and honest gaps

- **Reviewer identity**: The reviewer is identified by authenticated user ID only. No expanded reviewer profile entity.
- **Scoring policy**: Check weights and thresholds are code-configured server-side (in `trace-compare.ts`). Not yet editable by workspace admins via UI.
- **direct_provider replay**: Replay for `direct_provider` traces uses captured output, not a live provider call. Enterprise gateway is the only path with live execution in replay.
- **Scheduler runtime**: Regression schedules run automatically in long-lived Node app runtimes. The protected run-due endpoint remains available for platform cron fallbacks.
- **Token/cost data**: Only available when `executor.response_observability === "full"`. Enterprise gateway traces may have `partial` observability. The `token_regression` and cost diff checks correctly mark themselves as `unavailable` in this case.

