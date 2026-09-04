ALTER TABLE workflows
    ADD COLUMN IF NOT EXISTS creation_mode TEXT NOT NULL DEFAULT 'native';

ALTER TABLE workflows
    DROP CONSTRAINT IF EXISTS workflows_creation_mode_check;

ALTER TABLE workflows
    ADD CONSTRAINT workflows_creation_mode_check
    CHECK (creation_mode IN ('native', 'imported', 'instrumented', 'endpoint_only'));
