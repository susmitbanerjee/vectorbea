-- ============================================================
-- 2026-04-25  Unified Evaluation Dataset System
-- ============================================================
-- Adds evaluation_datasets + evaluation_dataset_items tables.
-- Baseline datasets are preserved; a compatibility view is
-- created so all existing queries continue working unchanged.
-- All objects live in the vectorbea schema to match the rest
-- of the application schema.
-- ============================================================

-- ── evaluation_datasets ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.evaluation_datasets (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID        NOT NULL,
  name           TEXT        NOT NULL,
  description    TEXT,
  dataset_type   TEXT        NOT NULL DEFAULT 'manual',
  -- manual | imported | runtime | golden | mixed
  item_count     INTEGER     NOT NULL DEFAULT 0,
  prompt_name    TEXT,
  created_by     TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evaluation_datasets_workspace_idx
  ON vectorbea.evaluation_datasets (workspace_id);

COMMENT ON TABLE vectorbea.evaluation_datasets IS
  'Flexible evaluation datasets: manual test cases, imported CSVs, runtime traces, or golden traces.';

-- ── evaluation_dataset_items ────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.evaluation_dataset_items (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id      UUID        NOT NULL REFERENCES vectorbea.evaluation_datasets(id) ON DELETE CASCADE,
  workspace_id    UUID        NOT NULL,
  source_type     TEXT        NOT NULL DEFAULT 'manual',
  -- manual | runtime_trace | golden_trace | imported
  input           TEXT        NOT NULL DEFAULT '',
  expected_output TEXT,
  trace_id        TEXT,          -- references audit_logs.id (nullable)
  metadata        JSONB,
  notes           TEXT,
  is_golden       BOOLEAN     NOT NULL DEFAULT FALSE,
  ord             INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eval_dataset_items_dataset_idx
  ON vectorbea.evaluation_dataset_items (dataset_id);

CREATE INDEX IF NOT EXISTS eval_dataset_items_workspace_idx
  ON vectorbea.evaluation_dataset_items (workspace_id);

CREATE INDEX IF NOT EXISTS eval_dataset_items_trace_idx
  ON vectorbea.evaluation_dataset_items (trace_id)
  WHERE trace_id IS NOT NULL;

COMMENT ON TABLE vectorbea.evaluation_dataset_items IS
  'Individual test-case rows inside an evaluation dataset.';

-- ── Auto-update item_count ───────────────────────────────────

CREATE OR REPLACE FUNCTION vectorbea.update_dataset_item_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vectorbea.evaluation_datasets
  SET item_count = (
    SELECT COUNT(*) FROM vectorbea.evaluation_dataset_items
    WHERE dataset_id = COALESCE(NEW.dataset_id, OLD.dataset_id)
  ),
  updated_at = NOW()
  WHERE id = COALESCE(NEW.dataset_id, OLD.dataset_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_eval_item_count ON vectorbea.evaluation_dataset_items;
CREATE TRIGGER trg_eval_item_count
  AFTER INSERT OR DELETE ON vectorbea.evaluation_dataset_items
  FOR EACH ROW EXECUTE FUNCTION vectorbea.update_dataset_item_count();

-- ── Baseline datasets compatibility ─────────────────────────
-- baseline_datasets rows are NOT migrated automatically.
-- The application adapter layer merges both sources at runtime.
-- This view lets SQL tooling see a unified picture.

CREATE OR REPLACE VIEW vectorbea.evaluation_datasets_unified AS
  SELECT
    id,
    workspace_id,
    name,
    description,
    'runtime'::text                          AS dataset_type,
    COALESCE(array_length(trace_ids, 1), 0) AS item_count,
    prompt_name,
    created_by::text                         AS created_by,
    created_at,
    updated_at,
    'baseline'::text                         AS origin
  FROM vectorbea.baseline_datasets
UNION ALL
  SELECT
    id,
    workspace_id,
    name,
    description,
    dataset_type,
    item_count,
    prompt_name,
    created_by,
    created_at,
    updated_at,
    'evaluation'::text                       AS origin
  FROM vectorbea.evaluation_datasets;

COMMENT ON VIEW vectorbea.evaluation_datasets_unified IS
  'Merged view of baseline_datasets (legacy) and evaluation_datasets (new).';
