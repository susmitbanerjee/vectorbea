# Control Plane Known Gaps (Current State)

This document captures intentional limitations that are surfaced in code and UI.

## 1) Reviewer identity

- Stored as authenticated **user id** only.
- No reviewer profile entity is modeled yet.
- UI labels should show reviewer as `Reviewer (User ID)`.

## 2) Scoring policy configuration

- Evaluation weights and critical-check behavior are code-configured.
- Current source of truth: `vectorbea-ui/lib/server/trace-compare.ts`.
- No UI editor for scoring weights is available yet.

## 3) Direct-provider replay limitation

- Direct-provider replay is simulated in this repository and may use captured output.
- Live replay path is enterprise-gateway execution.
- UI should clearly distinguish `simulated` vs `live`.

## 4) Scheduler gap

- No internal scheduler for regression runs or alert evaluation.
- Use external triggers:
  - `POST /api/evaluations/regression-schedules/{id}/run`
  - `POST /api/alerts/evaluate`

## 5) Token/cost observability

- Full token/cost visibility requires full observability mode.
- Enterprise gateway partial observability may not provide token/cost fields.
- Evaluation checks must mark unavailable data as unavailable (never forced to zero).

