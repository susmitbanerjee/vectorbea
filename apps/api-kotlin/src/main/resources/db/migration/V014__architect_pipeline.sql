-- =============================================================================
-- V014__architect_pipeline.sql
-- AI Workflow Architect Pipeline — connection requirements, generated tools,
-- generated agents, build steps, and session stage tracking.
-- =============================================================================

-- ── Extend sessions with pipeline stage columns ───────────────────────────────
ALTER TABLE workflow_architect_sessions
    ADD COLUMN IF NOT EXISTS current_stage              TEXT        NOT NULL DEFAULT 'understand_goal',
    ADD COLUMN IF NOT EXISTS approved_plan_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS connection_setup_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS tools_generated_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS agents_generated_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS workflow_graph_generated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS canvas_animation_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS readiness_status           TEXT        NOT NULL DEFAULT 'not_ready',
    ADD COLUMN IF NOT EXISTS readiness_issues_json      JSONB       NOT NULL DEFAULT '[]';

-- ── Connection requirements ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_architect_connection_requirements (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id            UUID        NOT NULL,
    session_id              UUID        NOT NULL REFERENCES workflow_architect_sessions(id) ON DELETE CASCADE,
    temp_connection_id      TEXT        NOT NULL,
    name                    TEXT        NOT NULL,
    type                    TEXT        NOT NULL,
    provider_hint           TEXT,
    description             TEXT,
    used_by_temp_ids        JSONB       NOT NULL DEFAULT '[]',
    required_for_simulation  BOOLEAN     NOT NULL DEFAULT false,
    required_for_real_execution BOOLEAN NOT NULL DEFAULT true,
    status                  TEXT        NOT NULL DEFAULT 'missing',
    bound_connection_id     UUID,
    test_status             TEXT,
    test_error_sanitized    TEXT,
    setup_instructions      TEXT,
    fields_needed_json      JSONB       NOT NULL DEFAULT '[]',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, temp_connection_id)
);

CREATE INDEX IF NOT EXISTS idx_architect_conn_req_session
    ON workflow_architect_connection_requirements (session_id);

-- ── Generated tools ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_architect_generated_tools (
    id                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id                UUID        NOT NULL,
    session_id                  UUID        NOT NULL REFERENCES workflow_architect_sessions(id) ON DELETE CASCADE,
    temp_tool_id                TEXT        NOT NULL,
    tool_id                     UUID,
    name                        TEXT        NOT NULL,
    type                        TEXT        NOT NULL,
    connection_requirement_id   UUID        REFERENCES workflow_architect_connection_requirements(id),
    bound_connection_id         UUID,
    status                      TEXT        NOT NULL DEFAULT 'planned',
    generated_config_json       JSONB       NOT NULL DEFAULT '{}',
    input_schema_json           JSONB       NOT NULL DEFAULT '{}',
    output_schema_json          JSONB       NOT NULL DEFAULT '{}',
    risk_level                  TEXT        NOT NULL DEFAULT 'low',
    requires_approval           BOOLEAN     NOT NULL DEFAULT false,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, temp_tool_id)
);

CREATE INDEX IF NOT EXISTS idx_architect_gen_tools_session
    ON workflow_architect_generated_tools (session_id);

-- ── Generated agents ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_architect_generated_agents (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id            UUID        NOT NULL,
    session_id              UUID        NOT NULL REFERENCES workflow_architect_sessions(id) ON DELETE CASCADE,
    temp_agent_id           TEXT        NOT NULL,
    agent_id                UUID,
    name                    TEXT        NOT NULL,
    type                    TEXT        NOT NULL DEFAULT 'native_llm_agent',
    role                    TEXT,
    generated_system_prompt TEXT        NOT NULL DEFAULT '',
    allowed_temp_tool_ids   JSONB       NOT NULL DEFAULT '[]',
    bound_tool_ids          JSONB       NOT NULL DEFAULT '[]',
    output_schema_json      JSONB       NOT NULL DEFAULT '{}',
    status                  TEXT        NOT NULL DEFAULT 'planned',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, temp_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_architect_gen_agents_session
    ON workflow_architect_generated_agents (session_id);

-- ── Build / animation steps ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_architect_build_steps (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id            UUID        NOT NULL,
    session_id              UUID        NOT NULL REFERENCES workflow_architect_sessions(id) ON DELETE CASCADE,
    sequence                INTEGER     NOT NULL,
    step_type               TEXT        NOT NULL,
    title                   TEXT        NOT NULL,
    description             TEXT,
    status                  TEXT        NOT NULL DEFAULT 'pending',
    target_type             TEXT,
    target_id               TEXT,
    payload_json_sanitized  JSONB       NOT NULL DEFAULT '{}',
    delay_ms                INTEGER     NOT NULL DEFAULT 0,
    started_at              TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_architect_build_steps_session
    ON workflow_architect_build_steps (session_id, sequence);
