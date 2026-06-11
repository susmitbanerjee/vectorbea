ALTER TABLE vectorbea.regression_schedules
  ADD COLUMN IF NOT EXISTS last_run_log jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS run_history jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS regression_schedules_due_idx
  ON vectorbea.regression_schedules(workspace_id, next_run_at)
  WHERE enabled = true;
