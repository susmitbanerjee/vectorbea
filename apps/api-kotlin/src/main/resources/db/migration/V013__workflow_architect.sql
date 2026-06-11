-- =============================================================================
-- V013__workflow_architect.sql
-- AI Workflow Architect — planning sessions, events, and usage tracking.
-- =============================================================================

-- ── Planning sessions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_architect_sessions (
    id                              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id                    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id                  UUID        NOT NULL,
    created_by_user_id              UUID        NOT NULL,
    status                          TEXT        NOT NULL DEFAULT 'draft',
    user_goal                       TEXT        NOT NULL,
    refined_goal                    TEXT,
    clarification_questions_json    JSONB       NOT NULL DEFAULT '[]',
    user_answers_json               JSONB       NOT NULL DEFAULT '{}',
    generated_plan_json             JSONB,
    generated_graph_json            JSONB,
    animation_steps_json            JSONB,
    generated_workflow_id           UUID,
    generated_workflow_version_id   UUID,
    failure_reason                  TEXT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT architect_status_check CHECK (
        status IN ('draft','needs_clarification','plan_generated',
                   'plan_approved','creating_workflow','workflow_created',
                   'failed','cancelled')
    )
);

CREATE INDEX IF NOT EXISTS idx_architect_sessions_workspace
    ON workflow_architect_sessions (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_architect_sessions_status
    ON workflow_architect_sessions (workspace_id, status);

-- ── Architect audit events ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_architect_events (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id    UUID        NOT NULL,
    session_id      UUID        NOT NULL REFERENCES workflow_architect_sessions(id) ON DELETE CASCADE,
    sequence        INTEGER     NOT NULL,
    event_type      TEXT        NOT NULL,
    title           TEXT        NOT NULL,
    message         TEXT,
    payload_json    JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_architect_events_session
    ON workflow_architect_events (session_id, sequence);

-- ── Daily usage tracking ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_architect_usage (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id            UUID        NOT NULL,
    usage_date              DATE        NOT NULL,
    planning_requests       INTEGER     NOT NULL DEFAULT 0,
    plan_generations        INTEGER     NOT NULL DEFAULT 0,
    workflow_creations      INTEGER     NOT NULL DEFAULT 0,
    tokens_used             INTEGER     NOT NULL DEFAULT 0,
    estimated_cost_cents    NUMERIC     NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_architect_usage_workspace
    ON workflow_architect_usage (workspace_id, usage_date);
