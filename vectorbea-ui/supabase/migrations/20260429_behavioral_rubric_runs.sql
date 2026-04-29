-- Behavioral rubric evaluation run persistence
-- Single-provider behavioral scoring foundation

CREATE TABLE IF NOT EXISTS vectorbea.evaluation_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  dataset_id          uuid NOT NULL REFERENCES vectorbea.behavioral_datasets(id) ON DELETE CASCADE,
  rubric_id           uuid NOT NULL REFERENCES vectorbea.evaluation_rubrics(id) ON DELETE CASCADE,
  prompt_id           uuid NOT NULL REFERENCES vectorbea.prompts(id) ON DELETE CASCADE,
  prompt_version_id   uuid NOT NULL REFERENCES vectorbea.prompt_versions(id) ON DELETE CASCADE,
  run_type            text NOT NULL DEFAULT 'behavioral_rubric',
  status              text NOT NULL DEFAULT 'queued',
  provider            text NOT NULL,
  model               text NOT NULL,
  started_by          text NOT NULL,
  started_at          timestamptz,
  completed_at        timestamptz,
  summary             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_runs_run_type_check CHECK (run_type IN ('baseline', 'golden_trace', 'behavioral_rubric', 'provider_arena', 'pairwise')),
  CONSTRAINT evaluation_runs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_evaluation_runs_workspace_created
  ON vectorbea.evaluation_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_dataset
  ON vectorbea.evaluation_runs (dataset_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_prompt_version
  ON vectorbea.evaluation_runs (prompt_version_id);

CREATE TABLE IF NOT EXISTS vectorbea.evaluation_executions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id   uuid NOT NULL REFERENCES vectorbea.evaluation_runs(id) ON DELETE CASCADE,
  dataset_item_id     uuid NOT NULL REFERENCES vectorbea.behavioral_dataset_items(id) ON DELETE CASCADE,
  provider_candidate_id uuid,
  status              text NOT NULL DEFAULT 'queued',
  input               text NOT NULL,
  context             text,
  output              text,
  provider            text NOT NULL,
  model               text NOT NULL,
  prompt_version_id   uuid NOT NULL REFERENCES vectorbea.prompt_versions(id) ON DELETE CASCADE,
  latency_ms          integer,
  cost_estimate       numeric(10,6),
  tokens_input        integer,
  tokens_output       integer,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_executions_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_evaluation_executions_run
  ON vectorbea.evaluation_executions (evaluation_run_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_executions_dataset_item
  ON vectorbea.evaluation_executions (dataset_item_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_executions_candidate
  ON vectorbea.evaluation_executions (provider_candidate_id);

CREATE TABLE IF NOT EXISTS vectorbea.judge_executions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id      uuid NOT NULL REFERENCES vectorbea.evaluation_runs(id) ON DELETE CASCADE,
  evaluation_execution_id uuid NOT NULL REFERENCES vectorbea.evaluation_executions(id) ON DELETE CASCADE,
  rubric_id              uuid NOT NULL REFERENCES vectorbea.evaluation_rubrics(id) ON DELETE CASCADE,
  judge_provider         text,
  judge_model            text,
  status                 text NOT NULL DEFAULT 'queued',
  overall_score          numeric(5,2),
  pass                   boolean,
  confidence             numeric(5,4),
  dimension_scores       jsonb NOT NULL DEFAULT '{}'::jsonb,
  hard_failures          jsonb NOT NULL DEFAULT '[]'::jsonb,
  strengths              jsonb NOT NULL DEFAULT '[]'::jsonb,
  weaknesses             jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_flags             jsonb NOT NULL DEFAULT '[]'::jsonb,
  verdict_reason         text,
  raw_judge_output       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT judge_executions_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_judge_executions_run
  ON vectorbea.judge_executions (evaluation_run_id);
CREATE INDEX IF NOT EXISTS idx_judge_executions_execution
  ON vectorbea.judge_executions (evaluation_execution_id);

CREATE TABLE IF NOT EXISTS vectorbea.provider_candidates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id   uuid NOT NULL REFERENCES vectorbea.evaluation_runs(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  model               text NOT NULL,
  label               text NOT NULL,
  temperature         numeric(5,3),
  max_tokens          integer,
  config              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_candidates_run
  ON vectorbea.provider_candidates (evaluation_run_id);

CREATE TABLE IF NOT EXISTS vectorbea.arena_reports (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_run_id        uuid NOT NULL REFERENCES vectorbea.evaluation_runs(id) ON DELETE CASCADE UNIQUE,
  recommended_candidate_id uuid REFERENCES vectorbea.provider_candidates(id) ON DELETE SET NULL,
  rollout_recommendation   text NOT NULL DEFAULT 'needs_review',
  decision_score           numeric(6,2),
  risk_score               numeric(6,2),
  summary                  text,
  provider_rankings        jsonb NOT NULL DEFAULT '[]'::jsonb,
  dimension_summary        jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_clusters         jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_summary             jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_summary          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arena_reports_recommendation_check CHECK (rollout_recommendation IN ('safe_to_rollout', 'rollout_with_caution', 'needs_review', 'do_not_rollout'))
);

CREATE INDEX IF NOT EXISTS idx_arena_reports_run
  ON vectorbea.arena_reports (evaluation_run_id);

CREATE OR REPLACE FUNCTION vectorbea.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'evaluation_runs_updated_at') THEN
    CREATE TRIGGER evaluation_runs_updated_at
      BEFORE UPDATE ON vectorbea.evaluation_runs
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'evaluation_executions_updated_at') THEN
    CREATE TRIGGER evaluation_executions_updated_at
      BEFORE UPDATE ON vectorbea.evaluation_executions
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'judge_executions_updated_at') THEN
    CREATE TRIGGER judge_executions_updated_at
      BEFORE UPDATE ON vectorbea.judge_executions
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'arena_reports_updated_at') THEN
    CREATE TRIGGER arena_reports_updated_at
      BEFORE UPDATE ON vectorbea.arena_reports
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
END $$;

ALTER TABLE vectorbea.evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.evaluation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.judge_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.provider_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.arena_reports ENABLE ROW LEVEL SECURITY;

GRANT ALL ON vectorbea.evaluation_runs TO service_role;
GRANT ALL ON vectorbea.evaluation_executions TO service_role;
GRANT ALL ON vectorbea.judge_executions TO service_role;
GRANT ALL ON vectorbea.provider_candidates TO service_role;
GRANT ALL ON vectorbea.arena_reports TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_evaluation_executions_provider_candidate'
  ) THEN
    ALTER TABLE vectorbea.evaluation_executions
      ADD CONSTRAINT fk_evaluation_executions_provider_candidate
      FOREIGN KEY (provider_candidate_id) REFERENCES vectorbea.provider_candidates(id) ON DELETE SET NULL;
  END IF;
END $$;
