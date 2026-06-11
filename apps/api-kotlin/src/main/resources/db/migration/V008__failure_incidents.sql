-- =============================================================================
-- V008__failure_incidents.sql
-- Recovery Engine tables: failure_incidents and recovery_attempts.
-- =============================================================================

CREATE TABLE IF NOT EXISTS failure_incidents (
    id                       UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id             UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id           UUID        NOT NULL,
    run_id                   UUID        NOT NULL,
    workflow_id              UUID        NOT NULL,
    workflow_version_id      UUID        NOT NULL,
    failed_step_id           TEXT,
    failed_node_id           TEXT,
    failed_agent_id          UUID,
    failed_tool_id           UUID,
    failed_connection_id     UUID,
    category                 TEXT        NOT NULL,
    code                     TEXT        NOT NULL,
    severity                 TEXT        NOT NULL,
    retryable                BOOLEAN     NOT NULL DEFAULT false,
    auto_replay_safe         BOOLEAN     NOT NULL DEFAULT false,
    requires_human_approval  BOOLEAN     NOT NULL DEFAULT false,
    summary                  TEXT        NOT NULL,
    technical_summary        TEXT,
    recommended_action       TEXT,
    remediation_json         JSONB       NOT NULL DEFAULT '{}',
    detected_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at              TIMESTAMPTZ,
    resolution_status        TEXT        NOT NULL DEFAULT 'open',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failure_incidents_ws_run
    ON failure_incidents (workspace_id, run_id);
CREATE INDEX IF NOT EXISTS idx_failure_incidents_ws_status
    ON failure_incidents (workspace_id, resolution_status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_failure_incidents_ws_category
    ON failure_incidents (workspace_id, category, detected_at DESC);

CREATE TABLE IF NOT EXISTS recovery_attempts (
    id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     UUID        NOT NULL,
    environment_id   UUID        NOT NULL,
    incident_id      UUID        NOT NULL REFERENCES failure_incidents(id) ON DELETE CASCADE,
    original_run_id  UUID        NOT NULL,
    replay_run_id    UUID,
    action           TEXT        NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'pending',
    reason           TEXT,
    checkpoint_id    UUID,
    created_by       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_recovery_attempts_ws_incident
    ON recovery_attempts (workspace_id, incident_id);
