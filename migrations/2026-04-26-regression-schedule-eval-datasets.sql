-- Allow regression_schedules to reference either a baseline_dataset OR an evaluation_dataset.
-- 1. Make baseline_dataset_id nullable (drop NOT NULL and FK, re-add as nullable FK)
-- 2. Add evaluation_dataset_id column with FK to evaluation_datasets

ALTER TABLE vectorbea.regression_schedules
  ALTER COLUMN baseline_dataset_id DROP NOT NULL;

-- Add evaluation_dataset_id (nullable FK to evaluation_datasets)
ALTER TABLE vectorbea.regression_schedules
  ADD COLUMN IF NOT EXISTS evaluation_dataset_id uuid
    REFERENCES vectorbea.evaluation_datasets(id) ON DELETE SET NULL;

-- At least one of the two dataset columns must be set (check constraint)
ALTER TABLE vectorbea.regression_schedules
  DROP CONSTRAINT IF EXISTS chk_regression_schedule_has_dataset;

ALTER TABLE vectorbea.regression_schedules
  ADD CONSTRAINT chk_regression_schedule_has_dataset
    CHECK (baseline_dataset_id IS NOT NULL OR evaluation_dataset_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS regression_schedules_eval_dataset_idx
  ON vectorbea.regression_schedules(evaluation_dataset_id);
