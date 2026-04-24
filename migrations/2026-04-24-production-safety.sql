-- VectorBea production-readiness schema patch
-- Apply on the target database before enabling baseline/golden/regression/alerts UI.

CREATE SCHEMA IF NOT EXISTS vectorbea;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS vectorbea.organizations
  ADD COLUMN IF NOT EXISTS subscription_status text,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

CREATE TABLE IF NOT EXISTS vectorbea.baseline_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  source_type text NOT NULL DEFAULT 'trace_set',
  trace_ids uuid[] NOT NULL DEFAULT '{}',
  prompt_name text,
  prompt_id uuid,
  prompt_version_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS baseline_datasets_workspace_idx
  ON vectorbea.baseline_datasets(workspace_id);

CREATE TABLE IF NOT EXISTS vectorbea.golden_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  trace_id text NOT NULL,
  prompt_name text,
  prompt_version text,
  prompt_version_id uuid,
  label text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, trace_id)
);

CREATE INDEX IF NOT EXISTS golden_traces_workspace_idx
  ON vectorbea.golden_traces(workspace_id);

CREATE TABLE IF NOT EXISTS vectorbea.regression_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  baseline_dataset_id uuid REFERENCES vectorbea.baseline_datasets(id) ON DELETE CASCADE,
  baseline_dataset_name text,
  candidate_prompt_version_strategy text NOT NULL DEFAULT 'latest_published',
  candidate_prompt_version_id uuid,
  prompt_name text,
  prompt_id uuid,
  cron_expression text,
  schedule_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'idle',
  last_run_at timestamptz,
  last_run_evaluation_run_id uuid,
  last_run_recommendation text,
  next_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS regression_schedules_workspace_idx
  ON vectorbea.regression_schedules(workspace_id);

CREATE TABLE IF NOT EXISTS vectorbea.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  metric_type text NOT NULL,
  threshold numeric NOT NULL,
  comparison text NOT NULL DEFAULT 'gt',
  window text,
  window_hours integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_rules_workspace_idx
  ON vectorbea.alert_rules(workspace_id);

CREATE TABLE IF NOT EXISTS vectorbea.alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES vectorbea.alert_rules(id) ON DELETE CASCADE,
  alert_rule_id uuid,
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  metric_value numeric,
  threshold numeric,
  prompt_name text,
  status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS alert_events_workspace_idx
  ON vectorbea.alert_events(workspace_id);

CREATE INDEX IF NOT EXISTS alert_events_rule_idx
  ON vectorbea.alert_events(rule_id);
