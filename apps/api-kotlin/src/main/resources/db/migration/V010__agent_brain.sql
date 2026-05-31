-- =============================================================================
-- V010__agent_brain.sql
-- Iterative Agent Brain — persistence tables for agent loop state.
--
-- 1. Extend agents table with brain config columns.
-- 2. agent_iterations  — one row per loop iteration (plan→act→observe).
-- 3. agent_memory_entries — sanitized run-scoped working memory.
-- 4. agent_decisions   — structured decision record per iteration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend agents table with iterative-agent fields
-- ---------------------------------------------------------------------------
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS planning_mode       TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS tool_choice_policy  TEXT NOT NULL DEFAULT 'auto',
    ADD COLUMN IF NOT EXISTS stop_policy         TEXT NOT NULL DEFAULT 'final_output',
    ADD COLUMN IF NOT EXISTS max_tool_calls      INTEGER,
    ADD COLUMN IF NOT EXISTS max_cost_cents      INTEGER,
    ADD COLUMN IF NOT EXISTS allowed_tool_ids    JSONB NOT NULL DEFAULT '[]';

-- planning_mode: 'none' | 'short_plan' | 'step_by_step'
-- tool_choice_policy: 'auto' | 'required' | 'restricted'
-- stop_policy: 'final_output' | 'no_more_actions' | 'max_iterations' | 'custom_condition'

-- ---------------------------------------------------------------------------
-- 2. agent_iterations
-- One row per loop iteration. Sanitized — no raw chain-of-thought.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_iterations (
    id                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id                UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id              UUID        NOT NULL,
    run_id                      UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    step_id                     TEXT        NOT NULL,
    agent_id                    UUID        NOT NULL,
    iteration_number            INTEGER     NOT NULL,
    status                      TEXT        NOT NULL DEFAULT 'running',
    -- Sanitized summaries only — no raw LLM output stored
    thought_summary_sanitized   TEXT,
    action_type                 TEXT,       -- THINK | CALL_TOOL | FINAL | ASK_APPROVAL | FAIL
    selected_tool_id            UUID,
    tool_call_id                UUID,
    llm_call_id                 UUID,
    observation_summary_sanitized TEXT,
    tokens_used                 INTEGER     NOT NULL DEFAULT 0,
    estimated_cost_cents        NUMERIC     NOT NULL DEFAULT 0,
    started_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at                TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_iterations_status_check
        CHECK (status IN ('running','completed','failed','skipped')),
    UNIQUE (run_id, step_id, iteration_number)
);

CREATE INDEX IF NOT EXISTS idx_agent_iterations_run_step
    ON agent_iterations (run_id, step_id, iteration_number);
CREATE INDEX IF NOT EXISTS idx_agent_iterations_workspace
    ON agent_iterations (workspace_id, run_id);

-- ---------------------------------------------------------------------------
-- 3. agent_memory_entries
-- Sanitized run-scoped working memory (no raw secrets, no raw credentials).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_memory_entries (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id            UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id          UUID        NOT NULL,
    run_id                  UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    agent_id                UUID        NOT NULL,
    step_id                 TEXT,
    memory_scope            TEXT        NOT NULL DEFAULT 'run_scoped',
    key                     TEXT        NOT NULL,
    value_json_sanitized    JSONB       NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_memory_scope_check
        CHECK (memory_scope IN ('run_scoped','workflow_scoped'))
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_run
    ON agent_memory_entries (workspace_id, run_id, agent_id);

-- ---------------------------------------------------------------------------
-- 4. agent_decisions
-- Structured decision record. Sanitized — no raw reasoning.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_decisions (
    id                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id                UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    run_id                      UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    agent_id                    UUID        NOT NULL,
    step_id                     TEXT        NOT NULL,
    iteration_id                UUID        NOT NULL REFERENCES agent_iterations(id) ON DELETE CASCADE,
    decision_type               TEXT        NOT NULL,
    decision_json_sanitized     JSONB       NOT NULL DEFAULT '{}',
    confidence                  NUMERIC,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_decisions_iteration
    ON agent_decisions (workspace_id, run_id, iteration_id);
