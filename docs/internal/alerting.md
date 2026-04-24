# Alerting Model

VectorBea alerting evaluates aggregated **runtime trace** metrics and stores alert events when thresholds are crossed.

## Supported rule metrics

- `latency_p95` (milliseconds)
- `error_rate` (percentage points)
- `eval_score_avg` (0-1 score)
- `cache_hit_rate` (percentage points)

## Scheduler model

Alert evaluation is exposed as an explicit operational endpoint.

Trigger alerts externally:

```
POST /api/alerts/evaluate?workspaceId={workspaceId}
```

Recommended external triggers:

- CI job (GitHub Actions / GitLab / Jenkins)
- External cron service
- Platform scheduler calling the endpoint on a cadence

## Data source and honesty rules

- Alert aggregation uses runtime traces only.
- Review/audit/promotion events are excluded.
- Missing observability is treated as unavailable and skipped rather than coerced to zero.


