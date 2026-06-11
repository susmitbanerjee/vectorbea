-- =============================================================================
-- V004__approvals_table.sql
-- Human-in-the-loop approval gates for workflow execution.
-- Created by the worker when an APPROVAL node is reached;
-- read and decided by the API (/api/approvals).
-- =============================================================================

CREATE TABLE IF NOT EXISTS approvals (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id                  UUID        NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    workflow_id             UUID        NOT NULL,
    step_id                 TEXT        NOT NULL,
    agent_id                UUID,
    -- status: pending | approved | rejected | expired
    status                  TEXT        NOT NULL DEFAULT 'pending',
    title                   TEXT        NOT NULL DEFAULT '',
    message                 TEXT,
    risk_level              TEXT        NOT NULL DEFAULT 'medium',
    requested_by            TEXT,
    decided_by              TEXT,
    requested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at              TIMESTAMPTZ,
    decision_reason         TEXT,
    -- sanitized context payload shown to the approver (no secrets)
    payload_json_sanitized  JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approvals_run_id     ON approvals (run_id);
CREATE INDEX IF NOT EXISTS idx_approvals_workflow_id ON approvals (workflow_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status      ON approvals (status) WHERE status = 'pending';

-- Keep the legacy run_approvals table but it is no longer written to.
-- Drop it only after confirming no old data needs to be migrated.
-- ALTER TABLE run_approvals RENAME TO run_approvals_deprecated;
