-- ============================================================
-- VectorBea Workflow Regression and Skill Correctness — Phase 2
-- 2026-05-04
-- ============================================================

-- Extend reliability rule types with deterministic business outcomes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'vectorbea'
      AND table_name = 'reliability_rules'
      AND constraint_name = 'reliability_rules_rule_type_check'
  ) THEN
    ALTER TABLE vectorbea.reliability_rules
      DROP CONSTRAINT reliability_rules_rule_type_check;
  END IF;
END $$;

ALTER TABLE vectorbea.reliability_rules
  ADD CONSTRAINT reliability_rules_rule_type_check
  CHECK (rule_type IN (
    'tool_sequence','tool_required','tool_forbidden',
    'argument_validation','schema_validation','regex_check',
    'cost_threshold','latency_threshold','max_tool_calls',
    'pii_detection','business_policy','human_handoff_required',
    'output_contains','output_not_contains',
    'tool_result_condition','final_action_condition',
    'business_outcome'
  ));

CREATE TABLE IF NOT EXISTS vectorbea.regression_suites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  capability_id uuid NOT NULL REFERENCES vectorbea.ai_capabilities(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  suite_type text NOT NULL DEFAULT 'deterministic_workflow'
    CHECK (suite_type IN ('deterministic_workflow','tool_trajectory','business_outcome','mixed')),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS vectorbea.regression_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  suite_id uuid NOT NULL REFERENCES vectorbea.regression_suites(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_tool_sequence jsonb NOT NULL DEFAULT '[]'::jsonb,
  forbidden_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_outcome text,
  expected_final_action text,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_level text NOT NULL DEFAULT 'medium'
    CHECK (risk_level IN ('low','medium','high','critical')),
  source_trace_id uuid REFERENCES vectorbea.workflow_traces(id) ON DELETE SET NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vectorbea.workflow_regression_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  suite_id uuid NOT NULL REFERENCES vectorbea.regression_suites(id) ON DELETE CASCADE,
  capability_id uuid NOT NULL REFERENCES vectorbea.ai_capabilities(id) ON DELETE CASCADE,
  capability_version_id uuid NOT NULL REFERENCES vectorbea.capability_versions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed','cancelled','timed_out')),
  trigger_source text NOT NULL DEFAULT 'manual'
    CHECK (trigger_source IN ('manual','candidate_promotion','api','scheduled')),
  started_by uuid NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_score numeric(5,2),
  passed_cases_count integer NOT NULL DEFAULT 0,
  failed_cases_count integer NOT NULL DEFAULT 0,
  critical_failures_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vectorbea.workflow_regression_case_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  regression_run_id uuid NOT NULL REFERENCES vectorbea.workflow_regression_runs(id) ON DELETE CASCADE,
  regression_case_id uuid NOT NULL REFERENCES vectorbea.regression_cases(id) ON DELETE CASCADE,
  workflow_trace_id uuid REFERENCES vectorbea.workflow_traces(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed','failed','skipped','error')),
  passed boolean NOT NULL DEFAULT false,
  score numeric(5,2),
  failure_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_sequence_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_tools_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  forbidden_tools_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vectorbea.trajectory_diff_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  left_trace_id uuid NOT NULL REFERENCES vectorbea.workflow_traces(id) ON DELETE CASCADE,
  right_trace_id uuid NOT NULL REFERENCES vectorbea.workflow_traces(id) ON DELETE CASCADE,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_sequence_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  argument_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vectorbea.capability_reliability_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  capability_id uuid NOT NULL REFERENCES vectorbea.ai_capabilities(id) ON DELETE CASCADE,
  capability_version_id uuid NOT NULL REFERENCES vectorbea.capability_versions(id) ON DELETE CASCADE,
  score numeric(5,2) NOT NULL DEFAULT 0,
  workflow_success_rate numeric(5,2),
  tool_path_compliance numeric(5,2),
  outcome_success_rate numeric(5,2),
  argument_validity numeric(5,2),
  cost_compliance numeric(5,2),
  latency_compliance numeric(5,2),
  safety_compliance numeric(5,2),
  source_run_id uuid REFERENCES vectorbea.workflow_regression_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regression_suites_workspace_capability
  ON vectorbea.regression_suites (workspace_id, capability_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_regression_cases_suite
  ON vectorbea.regression_cases (suite_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_regression_runs_suite
  ON vectorbea.workflow_regression_runs (suite_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_regression_runs_capability_version
  ON vectorbea.workflow_regression_runs (capability_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_regression_case_results_run
  ON vectorbea.workflow_regression_case_results (regression_run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_trajectory_diff_results_left_right
  ON vectorbea.trajectory_diff_results (left_trace_id, right_trace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capability_reliability_scores_capability_version
  ON vectorbea.capability_reliability_scores (capability_id, capability_version_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'regression_suites_updated_at') THEN
    CREATE TRIGGER regression_suites_updated_at
      BEFORE UPDATE ON vectorbea.regression_suites
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'regression_cases_updated_at') THEN
    CREATE TRIGGER regression_cases_updated_at
      BEFORE UPDATE ON vectorbea.regression_cases
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workflow_regression_runs_updated_at') THEN
    CREATE TRIGGER workflow_regression_runs_updated_at
      BEFORE UPDATE ON vectorbea.workflow_regression_runs
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
END $$;

ALTER TABLE vectorbea.regression_suites ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.regression_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.workflow_regression_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.workflow_regression_case_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.trajectory_diff_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.capability_reliability_scores ENABLE ROW LEVEL SECURITY;

GRANT ALL ON vectorbea.regression_suites TO service_role;
GRANT ALL ON vectorbea.regression_cases TO service_role;
GRANT ALL ON vectorbea.workflow_regression_runs TO service_role;
GRANT ALL ON vectorbea.workflow_regression_case_results TO service_role;
GRANT ALL ON vectorbea.trajectory_diff_results TO service_role;
GRANT ALL ON vectorbea.capability_reliability_scores TO service_role;
