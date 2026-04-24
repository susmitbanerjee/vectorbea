# Scheduled Regression Checks

Regression schedules pair a baseline dataset with a candidate prompt version strategy and execute trace-set evaluation runs repeatedly to catch regressions over time.

## Data model

Stored in `vectorbea.regression_schedules`. Key fields:
- `baseline_dataset_id` references `baseline_datasets.id`
- `candidate_prompt_version_strategy` is `latest_published` or `specific_version`
- `candidate_prompt_version_id` is used when the strategy is `specific_version`
- `cron_expression` is used by the built-in app-runtime scheduler to compute `next_run_at`
- `enabled` / `status` is `idle | running | failed | disabled`
- `last_run_at`, `last_run_evaluation_run_id`, `last_run_recommendation`
- `last_run_log` stores the latest schedule execution log
- `run_history` stores recent run logs for UI inspection

## Execution model

The app runtime starts a lightweight scheduler from `instrumentation.ts`. It checks enabled schedules with due `next_run_at` values and calls the same execution path used by the Run now button.

The deterministic endpoint remains available for operations and tests:

```text
POST /api/evaluations/regression-schedules/{id}/run?workspaceId={workspaceId}
```

There is also a protected due-run endpoint:

```text
POST /api/evaluations/regression-schedules/run-due
```

This endpoint requires `x-internal-secret` when `INTERNAL_API_SECRET` is configured.

Each run:
1. Resolves the candidate prompt version.
2. Loads trace IDs from the baseline dataset.
3. Creates a real trace-set evaluation run.
4. Replays or executes each trace through the configured executor.
5. Persists replay traces, per-trace checks, aggregate scoring, and run logs.
6. Updates `last_run_at`, `last_run_evaluation_run_id`, `last_run_recommendation`, `last_run_log`, `run_history`, and `next_run_at`.

## Failure handling

If execution fails, the schedule status is set to `failed` and `last_run_log` records:
- schedule id
- baseline dataset id/name
- candidate prompt version id when resolved
- replay count
- failed trace ids when available
- error reason
- started/completed timestamps

## Operational notes

- The built-in scheduler is intended for long-lived Node/server runtimes.
- The protected `run-due` endpoint is retained so platform cron or CI can trigger due schedules in deployments where runtime lifetimes are short.
- No raw provider API keys should appear in run logs.
