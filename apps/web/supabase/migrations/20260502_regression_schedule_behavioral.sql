ALTER TABLE vectorbea.regression_schedules
  ADD COLUMN IF NOT EXISTS behavioral_dataset_id uuid REFERENCES vectorbea.behavioral_datasets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS behavioral_dataset_name text,
  ADD COLUMN IF NOT EXISTS rubric_id uuid REFERENCES vectorbea.evaluation_rubrics(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rubric_name text;
