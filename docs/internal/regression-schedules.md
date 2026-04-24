# Scheduled Regression Checks

Regression schedules pair a baseline dataset with a candidate prompt version strategy and trigger evaluation runs repeatedly to catch regressions over time.

## Data model

Stored in `vectorbea.regression_schedules`. Key fields:
- `baseline_dataset_id` — references `baseline_datasets.id`
- `candidate_prompt_version_strategy` — `latest_published` or `specific_version`
- `candidate_prompt_version_id` — only used when strategy is `specific_version`
- `cron_expression` — for documentation/display purposes; not consumed by an internal runner
- `enabled` / `status` — `idle | running | failed | disabled`
- `last_run_at`, `last_run_evaluation_run_id`, `last_run_recommendation`

## Execution model

**No built-in cron runner exists in this repository.**

To trigger a scheduled regression check, call:

```
POST /api/evaluations/regression-schedules/{id}/run?workspaceId={workspaceId}
```

This endpoint:
1. Resolves the candidate prompt version (latest published or pinned)
2. Loads trace IDs from the baseline dataset
3. Creates a full trace-set evaluation run (replay + regression checks + aggregate scoring)
4. Updates `last_run_at`, `last_run_evaluation_run_id`, `last_run_recommendation` on the schedule

## Recommended invocation patterns

### GitHub Actions
```yaml
- name: Run regression schedule
  run: |
    curl -X POST \
      "https://your-app.vercel.app/api/evaluations/regression-schedules/$SCHEDULE_ID/run?workspaceId=$WORKSPACE_ID" \
      -H "Cookie: $SESSION_COOKIE"
```

### External cron service
Use cron-job.org, EasyCron, or a Vercel Cron route that calls this endpoint.

## Failure handling

If execution fails (dataset empty, no published version, gateway error), the schedule status is set to `failed` and `last_run_at` is recorded. The error is returned in the API response.

## Limitations

- No automatic retry on failure
- No email/Slack notification on failure (planned)
- `next_run_at` is stored but not auto-computed; populate from the caller if needed
