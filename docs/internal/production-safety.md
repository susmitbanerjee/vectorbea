# VectorBea Production Safety Layer

This document covers the launch safety controls currently implemented in the control plane.

## 1) API key setup (runtime)

- Runtime endpoints under `/api/proxy/*` require a workspace API key in `Authorization: Bearer <key>`.
- Key creation and revocation live in `/api-keys`.
- Keys are generated with environment-aware prefixes:
  - production: `vb_live_...`
  - non-production: `vb_test_...`
- Only key hashes are stored in the database (`api_keys.key_hash`).
- Plaintext key is returned only once at creation.

## 2) Workspace isolation

- Workspace access for dashboard APIs is enforced with `assertWorkspaceMember(...)`.
- Runtime workspace identity is resolved from the API key record, not request body input.
- Runtime writes are scoped to the API key workspace.

## 3) Plan limits and feature gates

- Feature checks are enforced server-side in `vectorbea-ui/lib/server/feature-gates.ts`.
- Current gated capabilities include:
  - evaluations
  - scheduled regressions
  - rollout
  - alerts
  - enterprise gateway mode

## 4) Usage quotas

- Monthly usage is computed server-side from runtime-scoped trace/audit records.
- Current tracked counters:
  - `runtime_traces`
  - `replay_runs`
  - `evaluation_runs`
- Quota checks are applied before expensive operations (runtime ingest, replay, evaluation runs).

## 5) Rate limiting

- Server-side rate limiting is applied to high-risk endpoints:
  - runtime prompt fetch/sync/ingest
  - replay
  - evaluation runs
  - regression run trigger
  - alert evaluation
- Current implementation uses in-memory process-local state.
- For multi-instance production deployments, move this to a shared store (Redis or equivalent).

## 6) LemonSqueezy webhook hardening

- Signature verification is required.
- Event processing is idempotent via `webhook_events.event_key`.
- Subscription lifecycle events update plan status consistently.
- Supported LemonSqueezy events include:
  - `subscription_created`
  - `subscription_updated`
  - `subscription_cancelled`
  - `subscription_resumed`
  - `subscription_expired`
  - `subscription_paused`
  - `subscription_payment_failed`
  - `subscription_payment_success`

## 7) Billing and usage UI

- Billing page shows:
  - current plan
  - prompt/audit usage
  - runtime/replay/evaluation usage counters
  - feature availability

## 8) Security hardening controls

- Payload size limits on critical mutation endpoints.
- Gateway URL safety validation blocks localhost/private metadata targets by default.
- Optional private gateway mode is explicitly controlled with `VECTORBEA_ALLOW_PRIVATE_GATEWAY_URLS=true`.
- Gateway execution timeout is enforced with `VECTORBEA_ENTERPRISE_GATEWAY_TIMEOUT_MS`.
- Baseline security headers are set in middleware:
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`

## 9) External scheduler note

- Regression schedules and alert evaluations are externally triggered.
- There is no built-in scheduler in this repository.

## 10) Known limitations (explicit)

- Reviewer identity uses authenticated user id only (no reviewer profile entity).
- Scoring policy is server-side code-configured (no UI editor yet).
- Direct-provider replay remains simulated/captured-output in this repo.
- Enterprise gateway mode is the fully real replay/execution path when configured.
- Token/cost metrics may be unavailable in partial observability mode and are treated as unavailable (not coerced to zero).
