-- ============================================================
-- VectorBea Behavioral Evaluations Foundation
-- 2026-04-29
-- ============================================================
-- Tables
--   behavioral_datasets          workspace-scoped, prompt-linked
--   behavioral_dataset_items     inputs without required expected output
--   evaluation_rubrics           rubric definitions per dataset
--   rubric_dimensions            scoring axes with weights
--   rubric_rules                 must-do / must-not-do / hard-fail constraints
-- ============================================================

-- ─── behavioral_datasets ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.behavioral_datasets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL,
  prompt_id       uuid        NOT NULL,
  name            text        NOT NULL,
  description     text,
  prompt_type     text        NOT NULL DEFAULT 'general'
                  CHECK (prompt_type IN (
                    'customer_support', 'rag_answer', 'summarization',
                    'classification', 'extraction', 'agent_workflow', 'general'
                  )),
  is_archived     boolean     NOT NULL DEFAULT false,
  item_count      int         NOT NULL DEFAULT 0,
  created_by      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_behavioral_datasets_workspace
  ON vectorbea.behavioral_datasets (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavioral_datasets_prompt
  ON vectorbea.behavioral_datasets (prompt_id);

-- ─── behavioral_dataset_items ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.behavioral_dataset_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id          uuid        NOT NULL REFERENCES vectorbea.behavioral_datasets(id) ON DELETE CASCADE,
  input               text        NOT NULL,
  context             text,
  metadata            jsonb,
  tags                text[]      NOT NULL DEFAULT '{}',
  risk_level          text        NOT NULL DEFAULT 'medium'
                      CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  reference_output    text,
  rubric_override     jsonb,
  source_trace_id     uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_behavioral_items_dataset
  ON vectorbea.behavioral_dataset_items (dataset_id, created_at DESC);

-- ─── evaluation_rubrics ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.evaluation_rubrics (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL,
  dataset_id      uuid        NOT NULL REFERENCES vectorbea.behavioral_datasets(id) ON DELETE CASCADE,
  prompt_id       uuid        NOT NULL,
  name            text        NOT NULL,
  prompt_type     text        NOT NULL DEFAULT 'general'
                  CHECK (prompt_type IN (
                    'customer_support', 'rag_answer', 'summarization',
                    'classification', 'extraction', 'agent_workflow', 'general'
                  )),
  goal            text,
  pass_threshold  int         NOT NULL DEFAULT 80
                  CHECK (pass_threshold BETWEEN 0 AND 100),
  judge_model     text,
  judge_provider  text,
  is_locked       boolean     NOT NULL DEFAULT false,
  created_by      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluation_rubrics_workspace
  ON vectorbea.evaluation_rubrics (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluation_rubrics_dataset
  ON vectorbea.evaluation_rubrics (dataset_id);

-- ─── rubric_dimensions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.rubric_dimensions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_id       uuid        NOT NULL REFERENCES vectorbea.evaluation_rubrics(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  weight          int         NOT NULL DEFAULT 20
                  CHECK (weight BETWEEN 0 AND 100),
  scale_min       int         NOT NULL DEFAULT 0,
  scale_max       int         NOT NULL DEFAULT 100,
  pass_threshold  int         NOT NULL DEFAULT 70
                  CHECK (pass_threshold BETWEEN 0 AND 100),
  ord             int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rubric_dimensions_rubric
  ON vectorbea.rubric_dimensions (rubric_id, ord ASC);

-- ─── rubric_rules ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.rubric_rules (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_id       uuid        NOT NULL REFERENCES vectorbea.evaluation_rubrics(id) ON DELETE CASCADE,
  rule_type       text        NOT NULL
                  CHECK (rule_type IN ('must_do', 'must_not_do', 'hard_fail')),
  description     text        NOT NULL,
  severity        text        NOT NULL DEFAULT 'medium'
                  CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rubric_rules_rubric
  ON vectorbea.rubric_rules (rubric_id, created_at ASC);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────
-- Reuse set_updated_at() from 20260429_demo_requests.sql if it exists,
-- otherwise create it here.

CREATE OR REPLACE FUNCTION vectorbea.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'behavioral_datasets_updated_at'
  ) THEN
    CREATE TRIGGER behavioral_datasets_updated_at
      BEFORE UPDATE ON vectorbea.behavioral_datasets
      FOR EACH ROW EXECUTE PROCEDURE vectorbea.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'behavioral_items_updated_at'
  ) THEN
    CREATE TRIGGER behavioral_items_updated_at
      BEFORE UPDATE ON vectorbea.behavioral_dataset_items
      FOR EACH ROW EXECUTE PROCEDURE vectorbea.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'evaluation_rubrics_updated_at'
  ) THEN
    CREATE TRIGGER evaluation_rubrics_updated_at
      BEFORE UPDATE ON vectorbea.evaluation_rubrics
      FOR EACH ROW EXECUTE PROCEDURE vectorbea.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'rubric_dimensions_updated_at'
  ) THEN
    CREATE TRIGGER rubric_dimensions_updated_at
      BEFORE UPDATE ON vectorbea.rubric_dimensions
      FOR EACH ROW EXECUTE PROCEDURE vectorbea.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'rubric_rules_updated_at'
  ) THEN
    CREATE TRIGGER rubric_rules_updated_at
      BEFORE UPDATE ON vectorbea.rubric_rules
      FOR EACH ROW EXECUTE PROCEDURE vectorbea.set_updated_at();
  END IF;
END;
$$;

-- ─── Item count maintenance ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION vectorbea.sync_behavioral_item_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vectorbea.behavioral_datasets
  SET item_count = (
    SELECT COUNT(*) FROM vectorbea.behavioral_dataset_items
    WHERE dataset_id = COALESCE(NEW.dataset_id, OLD.dataset_id)
  )
  WHERE id = COALESCE(NEW.dataset_id, OLD.dataset_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'sync_behavioral_item_count_insert'
  ) THEN
    CREATE TRIGGER sync_behavioral_item_count_insert
      AFTER INSERT ON vectorbea.behavioral_dataset_items
      FOR EACH ROW EXECUTE PROCEDURE vectorbea.sync_behavioral_item_count();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'sync_behavioral_item_count_delete'
  ) THEN
    CREATE TRIGGER sync_behavioral_item_count_delete
      AFTER DELETE ON vectorbea.behavioral_dataset_items
      FOR EACH ROW EXECUTE PROCEDURE vectorbea.sync_behavioral_item_count();
  END IF;
END;
$$;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE vectorbea.behavioral_datasets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.behavioral_dataset_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.evaluation_rubrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.rubric_dimensions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.rubric_rules             ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically.

-- ─── Grants ───────────────────────────────────────────────────────────────────

GRANT ALL ON ALL TABLES    IN SCHEMA vectorbea TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vectorbea TO service_role;
