# VectorBea Internal Job Runner

All internal jobs are HTTP endpoints protected by `INTERNAL_JOB_TOKEN`.

## Configuration

Add to your environment:

```env
INTERNAL_JOB_TOKEN=<strong-random-secret>   # Required in production
APP_URL=https://your-app.vercel.app
```

## Endpoints

| Endpoint | Purpose | Recommended schedule |
|---|---|---|
| `POST /api/internal/jobs/run-due-regressions` | Run all due regression schedules | Every hour |
| `POST /api/internal/jobs/evaluate-alerts` | Evaluate all alert rules | Every 5 minutes |
| `POST /api/internal/jobs/aggregate-metrics` | Pre-aggregate metrics + quota warnings | Every hour |
| `POST /api/internal/jobs/run-auto-evaluations` | Auto-evaluate candidate/active versions | Every 30 minutes |

All endpoints return:
```json
{
  "ok": true,
  "jobsAttempted": 5,
  "jobsSucceeded": 4,
  "jobsFailed": 1,
  "logs": ["workspace abc: ...error..."]
}
```

## Authentication

Pass the token in the `x-internal-job-token` header:

```
x-internal-job-token: your-secret-here
```

Backward-compat headers also accepted: `x-internal-secret`, `Authorization: Bearer <token>`.

---

## Cron Setup Examples

### Vercel Cron (vercel.json)

```json
{
  "crons": [
    {
      "path": "/api/internal/jobs/run-due-regressions",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/internal/jobs/evaluate-alerts",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/internal/jobs/aggregate-metrics",
      "schedule": "0 * * * *"
    },
    {
      "path": "/api/internal/jobs/run-auto-evaluations",
      "schedule": "*/30 * * * *"
    }
  ]
}
```

**Note:** Vercel Cron does not send the auth header. Use a Vercel Edge Config secret or add Vercel's IP allowlist instead of `INTERNAL_JOB_TOKEN` in that case, or trigger from a GitHub Action with the header set.

### GitHub Actions

```yaml
name: VectorBea jobs
on:
  schedule:
    - cron: '*/5 * * * *'   # evaluate-alerts
    - cron: '0 * * * *'     # regressions + metrics

jobs:
  evaluate-alerts:
    runs-on: ubuntu-latest
    steps:
      - name: Evaluate alerts
        run: |
          curl -s -X POST \
            -H "x-internal-job-token: ${{ secrets.INTERNAL_JOB_TOKEN }}" \
            "${{ secrets.APP_URL }}/api/internal/jobs/evaluate-alerts"

  regressions:
    runs-on: ubuntu-latest
    steps:
      - name: Run due regressions
        run: |
          curl -s -X POST \
            -H "x-internal-job-token: ${{ secrets.INTERNAL_JOB_TOKEN }}" \
            "${{ secrets.APP_URL }}/api/internal/jobs/run-due-regressions"
```

### Linux Crontab

```cron
# Every 5 minutes: alert evaluation
*/5 * * * * curl -s -X POST -H "x-internal-job-token: $TOKEN" $APP_URL/api/internal/jobs/evaluate-alerts

# Every hour: regressions
0 * * * * curl -s -X POST -H "x-internal-job-token: $TOKEN" $APP_URL/api/internal/jobs/run-due-regressions

# Every hour: metrics
0 * * * * curl -s -X POST -H "x-internal-job-token: $TOKEN" $APP_URL/api/internal/jobs/aggregate-metrics

# Every 30 minutes: auto-evaluations
*/30 * * * * curl -s -X POST -H "x-internal-job-token: $TOKEN" $APP_URL/api/internal/jobs/run-auto-evaluations
```

---

## Backward-Compatible Run-Due-Regressions

The original endpoint at `/api/evaluations/regression-schedules/run-due` still works and uses the same `INTERNAL_API_SECRET` auth. The new `/api/internal/jobs/run-due-regressions` endpoint is the canonical path going forward and supports both `INTERNAL_JOB_TOKEN` and `INTERNAL_API_SECRET`.
