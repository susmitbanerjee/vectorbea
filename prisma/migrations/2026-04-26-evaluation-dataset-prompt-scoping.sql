-- Evaluation dataset prompt-scoping and reference output support
-- 1. Add prompt_id (FK to prompts) to evaluation_datasets
-- 2. Add source_prompt_id, source_prompt_version_id, reference_output to evaluation_dataset_items

-- ── evaluation_datasets ───────────────────────────────────────────────────────

ALTER TABLE vectorbea.evaluation_datasets
  ADD COLUMN IF NOT EXISTS prompt_id UUID
    REFERENCES vectorbea.prompts(id) ON DELETE SET NULL;

-- Index for fast lookup by prompt
CREATE INDEX IF NOT EXISTS evaluation_datasets_prompt_id_idx
  ON vectorbea.evaluation_datasets(prompt_id);

-- ── evaluation_dataset_items ──────────────────────────────────────────────────

-- Which prompt version produced this item's input/trace
ALTER TABLE vectorbea.evaluation_dataset_items
  ADD COLUMN IF NOT EXISTS source_prompt_id UUID;

ALTER TABLE vectorbea.evaluation_dataset_items
  ADD COLUMN IF NOT EXISTS source_prompt_version_id UUID;

-- The known-good reference output for similarity scoring
-- (for golden_trace items this is populated from the original trace output)
ALTER TABLE vectorbea.evaluation_dataset_items
  ADD COLUMN IF NOT EXISTS reference_output TEXT;

-- Backfill: for existing items that have a trace_id, try to pull
-- source_prompt_id from the audit_log metadata if available
-- (best-effort; leaves NULL if trace metadata doesn't have it)
UPDATE vectorbea.evaluation_dataset_items edi
SET source_prompt_id = (
  SELECT (al.metadata->>'promptId')::uuid
  FROM vectorbea.audit_logs al
  WHERE al.id::text = edi.trace_id
  LIMIT 1
)
WHERE edi.trace_id IS NOT NULL
  AND edi.source_prompt_id IS NULL;

-- Backfill reference_output for golden_trace items from audit_log
-- Only populates when the audit_log row has a response body we can read
UPDATE vectorbea.evaluation_dataset_items edi
SET reference_output = (
  SELECT al.metadata->>'outputText'
  FROM vectorbea.audit_logs al
  WHERE al.id::text = edi.trace_id
  LIMIT 1
)
WHERE edi.source_type = 'golden_trace'
  AND edi.trace_id IS NOT NULL
  AND edi.reference_output IS NULL;

-- Index for lookups by source prompt
CREATE INDEX IF NOT EXISTS evaluation_dataset_items_source_prompt_idx
  ON vectorbea.evaluation_dataset_items(source_prompt_id);
