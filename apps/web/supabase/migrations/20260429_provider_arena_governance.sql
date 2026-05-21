-- Provider Arena governance hardening
-- Pairwise comparisons, review queue, rollout gate checks, and comparison reports

CREATE TABLE IF NOT EXISTS vectorbea.pairwise_comparisons (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id        uuid NOT NULL REFERENCES vectorbea.evaluation_runs(id) ON DELETE CASCADE,
  dataset_item_id          uuid NOT NULL REFERENCES vectorbea.behavioral_dataset_items(id) ON DELETE CASCADE,
  candidate_a_execution_id uuid NOT NULL REFERENCES vectorbea.evaluation_executions(id) ON DELETE CASCADE,
  candidate_b_execution_id uuid NOT NULL REFERENCES vectorbea.evaluation_executions(id) ON DELETE CASCADE,
  winner_execution_id      uuid REFERENCES vectorbea.evaluation_executions(id) ON DELETE SET NULL,
  result                   text NOT NULL,
  confidence               numeric(5,4),
  reasoning                text,
  dimension_preferences    jsonb NOT NULL DEFAULT '{}'::jsonb,
  judge_provider           text,
  judge_model              text,
  blind_order              jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_flags               jsonb NOT NULL DEFAULT '[]'::jsonb,
  needs_review_reason      text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pairwise_comparisons_result_check CHECK (result IN ('a_wins', 'b_wins', 'tie', 'both_bad', 'needs_review'))
);

CREATE INDEX IF NOT EXISTS idx_pairwise_run ON vectorbea.pairwise_comparisons (evaluation_run_id);
CREATE INDEX IF NOT EXISTS idx_pairwise_item ON vectorbea.pairwise_comparisons (dataset_item_id);

CREATE TABLE IF NOT EXISTS vectorbea.human_review_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  evaluation_run_id      uuid NOT NULL REFERENCES vectorbea.evaluation_runs(id) ON DELETE CASCADE,
  dataset_item_id        uuid REFERENCES vectorbea.behavioral_dataset_items(id) ON DELETE SET NULL,
  evaluation_execution_id uuid REFERENCES vectorbea.evaluation_executions(id) ON DELETE SET NULL,
  pairwise_comparison_id uuid REFERENCES vectorbea.pairwise_comparisons(id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'open',
  assigned_to            text,
  reason                 text NOT NULL,
  severity               text NOT NULL DEFAULT 'medium',
  reviewer_decision      text,
  reviewer_notes         text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  reviewed_at            timestamptz,
  CONSTRAINT human_review_items_status_check CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
  CONSTRAINT human_review_items_decision_check CHECK (
    reviewer_decision IS NULL OR reviewer_decision IN (
      'acceptable',
      'not_acceptable',
      'provider_a_better',
      'provider_b_better',
      'both_acceptable',
      'both_unacceptable',
      'rubric_needs_update'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_human_review_workspace_status ON vectorbea.human_review_items (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_human_review_run ON vectorbea.human_review_items (evaluation_run_id);

CREATE TABLE IF NOT EXISTS vectorbea.rollout_gate_checks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  prompt_id          uuid NOT NULL REFERENCES vectorbea.prompts(id) ON DELETE CASCADE,
  prompt_version_id  uuid NOT NULL REFERENCES vectorbea.prompt_versions(id) ON DELETE CASCADE,
  target_environment text NOT NULL DEFAULT 'production',
  status             text NOT NULL,
  checked_by         text NOT NULL,
  checked_at         timestamptz NOT NULL DEFAULT now(),
  reasons            jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluation_run_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_score         numeric(6,2),
  decision           text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rollout_gate_checks_status_check CHECK (status IN ('passed', 'blocked', 'needs_review')),
  CONSTRAINT rollout_gate_checks_decision_check CHECK (decision IN ('safe_to_rollout', 'rollout_with_caution', 'needs_review', 'do_not_rollout'))
);

CREATE INDEX IF NOT EXISTS idx_rollout_gate_workspace_prompt ON vectorbea.rollout_gate_checks (workspace_id, prompt_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.evaluation_comparison_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  created_by         text NOT NULL,
  run_ids            jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary            text,
  score_delta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  pass_rate_delta    jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_delta      jsonb NOT NULL DEFAULT '{}'::jsonb,
  dimension_deltas   jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_delta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_delta      jsonb NOT NULL DEFAULT '{}'::jsonb,
  regression_cases   jsonb NOT NULL DEFAULT '[]'::jsonb,
  improvement_cases  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_comparison_reports_workspace
  ON vectorbea.evaluation_comparison_reports (workspace_id, created_at DESC);

ALTER TABLE vectorbea.pairwise_comparisons ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.human_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.rollout_gate_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.evaluation_comparison_reports ENABLE ROW LEVEL SECURITY;

GRANT ALL ON vectorbea.pairwise_comparisons TO service_role;
GRANT ALL ON vectorbea.human_review_items TO service_role;
GRANT ALL ON vectorbea.rollout_gate_checks TO service_role;
GRANT ALL ON vectorbea.evaluation_comparison_reports TO service_role;
