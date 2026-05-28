-- =============================================================================
-- Vectorbea — Complete Database Schema
--
-- SOURCE OF TRUTH: This file mirrors V001__initial_schema.sql exactly,
-- plus the Flyway baseline row and worker auxiliary tables.
--
-- Use this when provisioning a fresh database manually (Neon, Supabase, etc.)
-- instead of relying on Flyway auto-migration at API startup.
--
-- Run order:
--   1. psql -h HOST -U USER -d vectorbea -f schema.sql
--   2. Start api-kotlin  (set RUN_MIGRATIONS=false — schema already applied)
--   3. Start worker-kotlin (creates step_outputs, run_approvals, connection_secrets
--                           via ensureTable calls on startup)
--
-- Postgres 14+ required (gen_random_uuid(), JSONB, TIMESTAMPTZ).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- workspaces
-- Root tenant entity. All other tables reference workspace_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
    id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name        TEXT        NOT NULL,
    slug        TEXT        NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces (slug);

-- ---------------------------------------------------------------------------
-- environments
-- Logical environments (production, staging, dev) within a workspace.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS environments (
    id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    slug         TEXT        NOT NULL,
    type         TEXT        NOT NULL,   -- 'production' | 'staging' | 'development' | 'sandbox'
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_environments_workspace_id ON environments (workspace_id);

-- ---------------------------------------------------------------------------
-- connections
-- External service connections (LLM providers, databases, APIs).
-- secret_ref points to the encrypted_secrets table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connections (
    id                                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id                      UUID        NOT NULL,
    environment_id                    UUID        NOT NULL,
    name                              TEXT        NOT NULL,
    slug                              TEXT        NOT NULL,
    type                              TEXT        NOT NULL,   -- 'llm' | 'database' | 'http' | 'tool'
    provider                          TEXT        NOT NULL,   -- 'openai' | 'anthropic' | 'neon' | ...
    status                            TEXT        NOT NULL DEFAULT 'not_tested',
    network_status                    TEXT        NOT NULL DEFAULT 'unknown',
    auth_type                         TEXT        NOT NULL,   -- 'api_key' | 'oauth2' | 'basic' | ...
    secret_ref                        TEXT,                  -- references encrypted_secrets.id (UUID as text)
    config_json                       JSONB       NOT NULL DEFAULT '{}',
    allowed_hosts                     JSONB       NOT NULL DEFAULT '[]',
    allowed_paths                     JSONB       NOT NULL DEFAULT '[]',
    allowed_schemas                   JSONB       NOT NULL DEFAULT '[]',
    allowed_tables                    JSONB       NOT NULL DEFAULT '[]',
    last_tested_at                    TIMESTAMPTZ,
    last_test_status                  TEXT,
    last_test_latency_ms              INTEGER,
    last_test_error_code              TEXT,
    last_test_error_message_sanitized TEXT,
    created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connections_workspace_id    ON connections (workspace_id);
CREATE INDEX IF NOT EXISTS idx_connections_environment_id  ON connections (environment_id);
CREATE INDEX IF NOT EXISTS idx_connections_status          ON connections (workspace_id, status);

-- ---------------------------------------------------------------------------
-- encrypted_secrets
-- AES-256-GCM ciphertext storage. Never contains plaintext.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS encrypted_secrets (
    id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id      UUID        NOT NULL,
    connection_id     UUID,                -- nullable: some secrets are workspace-level
    secret_ciphertext TEXT        NOT NULL,
    key_version       TEXT        NOT NULL,
    masked_preview    TEXT,               -- e.g. "sk-...XXXX" (safe to display)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_encrypted_secrets_workspace_id  ON encrypted_secrets (workspace_id);
CREATE INDEX IF NOT EXISTS idx_encrypted_secrets_connection_id ON encrypted_secrets (connection_id)
    WHERE connection_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- agents
-- AI agent definitions — LLM + instructions + policies.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    environment_id       UUID        NOT NULL,
    name                 TEXT        NOT NULL,
    slug                 TEXT        NOT NULL,
    type                 TEXT        NOT NULL,   -- 'conversational' | 'task' | 'supervisor' | ...
    role                 TEXT,
    instructions         TEXT,
    llm_connection_id    UUID,
    model_name           TEXT,
    temperature          NUMERIC,
    max_tokens           INTEGER,
    max_iterations       INTEGER,
    memory_policy_json   JSONB       NOT NULL DEFAULT '{}',
    retry_policy_json    JSONB       NOT NULL DEFAULT '{}',
    timeout_policy_json  JSONB       NOT NULL DEFAULT '{}',
    approval_policy_json JSONB       NOT NULL DEFAULT '{}',
    output_schema_json   JSONB       NOT NULL DEFAULT '{}',
    status               TEXT        NOT NULL DEFAULT 'active',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_workspace_id   ON agents (workspace_id);
CREATE INDEX IF NOT EXISTS idx_agents_environment_id ON agents (environment_id);
CREATE INDEX IF NOT EXISTS idx_agents_status         ON agents (workspace_id, status);

-- ---------------------------------------------------------------------------
-- tools
-- Tool definitions — HTTP calls, DB queries, code runners, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tools (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    environment_id       UUID        NOT NULL,
    name                 TEXT        NOT NULL,
    slug                 TEXT        NOT NULL,
    type                 TEXT        NOT NULL,   -- 'http' | 'database' | 'code' | 'builtin'
    description          TEXT,
    connection_id        UUID,
    input_schema_json    JSONB       NOT NULL DEFAULT '{}',
    output_schema_json   JSONB       NOT NULL DEFAULT '{}',
    config_json          JSONB       NOT NULL DEFAULT '{}',
    risk_level           TEXT        NOT NULL DEFAULT 'low',
    requires_approval    BOOLEAN     NOT NULL DEFAULT false,
    timeout_ms           INTEGER,
    retry_policy_json    JSONB       NOT NULL DEFAULT '{}',
    idempotency_strategy TEXT,
    status               TEXT        NOT NULL DEFAULT 'active',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tools_workspace_id   ON tools (workspace_id);
CREATE INDEX IF NOT EXISTS idx_tools_environment_id ON tools (environment_id);
CREATE INDEX IF NOT EXISTS idx_tools_connection_id  ON tools (connection_id) WHERE connection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tools_status         ON tools (workspace_id, status);

-- ---------------------------------------------------------------------------
-- workflows
-- Workflow definitions — DAGs of agents, tools, and routing logic.
-- current_version_id points to the latest published workflow_versions row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflows (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id        UUID        NOT NULL,
    environment_id      UUID        NOT NULL,
    name                TEXT        NOT NULL,
    slug                TEXT        NOT NULL,
    description         TEXT,
    status              TEXT        NOT NULL DEFAULT 'draft',
    current_version_id  UUID,               -- FK set after first version is created
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_workspace_id   ON workflows (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workflows_environment_id ON workflows (environment_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status         ON workflows (workspace_id, status);

-- ---------------------------------------------------------------------------
-- workflow_versions
-- Immutable snapshots of a workflow graph. Each publish creates a new version.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_versions (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workflow_id          UUID        NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
    version              INTEGER     NOT NULL,
    graph_json           JSONB       NOT NULL,
    input_schema_json    JSONB       NOT NULL DEFAULT '{}',
    output_schema_json   JSONB       NOT NULL DEFAULT '{}',
    trigger_config_json  JSONB       NOT NULL DEFAULT '{}',
    retry_policy_json    JSONB       NOT NULL DEFAULT '{}',
    timeout_policy_json  JSONB       NOT NULL DEFAULT '{}',
    budget_policy_json   JSONB       NOT NULL DEFAULT '{}',
    replay_support       TEXT        NOT NULL DEFAULT 'full',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id ON workflow_versions (workflow_id);

-- Now we can add the FK from workflows → workflow_versions
ALTER TABLE workflows
    ADD CONSTRAINT fk_workflows_current_version
    FOREIGN KEY (current_version_id) REFERENCES workflow_versions (id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- agent_runs
-- Each workflow execution creates one agent_run record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
    id                   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id         UUID        NOT NULL,
    environment_id       UUID        NOT NULL,
    workflow_id          UUID        NOT NULL REFERENCES workflows (id),
    workflow_version_id  UUID        NOT NULL REFERENCES workflow_versions (id),
    status               TEXT        NOT NULL DEFAULT 'queued',
    trigger_type         TEXT        NOT NULL DEFAULT 'manual',
    input_json           JSONB       NOT NULL DEFAULT '{}',
    output_json          JSONB,
    error_json           JSONB,
    current_step_id      TEXT,
    current_agent_id     UUID,
    idempotency_key      TEXT,
    started_at           TIMESTAMPTZ,
    completed_at         TIMESTAMPTZ,
    duration_ms          BIGINT,
    token_count          INTEGER,
    estimated_cost       NUMERIC,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_id         ON agent_runs (workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_environment_id       ON agent_runs (environment_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_workflow_id          ON agent_runs (workflow_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_workflow_version_id  ON agent_runs (workflow_version_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status               ON agent_runs (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_idempotency_key      ON agent_runs (workspace_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- run_events
-- Immutable, ordered event log for each run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_events (
    id                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id                      UUID        NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    workspace_id                UUID        NOT NULL,
    environment_id              UUID        NOT NULL,
    sequence                    INTEGER     NOT NULL,
    type                        TEXT        NOT NULL,
    status                      TEXT        NOT NULL,
    source                      TEXT        NOT NULL,
    timestamp                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms                 BIGINT,
    step_id                     TEXT,
    agent_id                    UUID,
    tool_id                     UUID,
    connection_id               UUID,
    model_name                  TEXT,
    parent_event_id             UUID,
    correlation_id              TEXT,
    trace_id                    TEXT,
    retry_attempt               INTEGER,
    checkpoint_id               UUID,
    title                       TEXT,
    summary                     TEXT,
    input_json_sanitized        JSONB,
    output_json_sanitized       JSONB,
    metadata_json_sanitized     JSONB,
    error_json_sanitized        JSONB,
    token_count                 INTEGER,
    estimated_cost              NUMERIC,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_id            ON run_events (run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_run_events_run_timestamp     ON run_events (run_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_run_events_workspace_id      ON run_events (workspace_id);
CREATE INDEX IF NOT EXISTS idx_run_events_type              ON run_events (run_id, type);

-- ---------------------------------------------------------------------------
-- run_event_logs
-- Append-only log lines attached to a run_event (for verbose agent output).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_event_logs (
    id                       UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_event_id             UUID        NOT NULL REFERENCES run_events (id) ON DELETE CASCADE,
    run_id                   UUID        NOT NULL,
    timestamp                TIMESTAMPTZ NOT NULL DEFAULT now(),
    level                    TEXT        NOT NULL DEFAULT 'info',
    source                   TEXT        NOT NULL,
    message_sanitized        TEXT        NOT NULL,
    metadata_json_sanitized  JSONB,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_event_logs_run_event_id ON run_event_logs (run_event_id);
CREATE INDEX IF NOT EXISTS idx_run_event_logs_run_id       ON run_event_logs (run_id);

-- ---------------------------------------------------------------------------
-- run_checkpoints
-- Point-in-time snapshots of workflow state, enabling resume/replay.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_checkpoints (
    id                            UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id                        UUID        NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    workflow_id                   UUID        NOT NULL,
    workflow_version_id           UUID        NOT NULL,
    step_id                       TEXT        NOT NULL,
    agent_id                      UUID,
    sequence                      INTEGER     NOT NULL,
    state_json_sanitized          JSONB       NOT NULL DEFAULT '{}',
    input_json_sanitized          JSONB,
    output_so_far_json_sanitized  JSONB,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_checkpoints_run_id ON run_checkpoints (run_id);

-- ---------------------------------------------------------------------------
-- approvals
-- Human-in-the-loop approval gates. A run waits until status = 'approved'.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS approvals (
    id                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id                      UUID        NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    workflow_id                 UUID        NOT NULL,
    step_id                     TEXT        NOT NULL,
    agent_id                    UUID,
    status                      TEXT        NOT NULL DEFAULT 'pending',
    title                       TEXT        NOT NULL,
    message                     TEXT,
    risk_level                  TEXT        NOT NULL DEFAULT 'medium',
    requested_by                TEXT,
    decided_by                  TEXT,
    requested_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at                  TIMESTAMPTZ,
    decision_reason             TEXT,
    payload_json_sanitized      JSONB,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approvals_run_id    ON approvals (run_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status    ON approvals (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_workspace ON approvals (workflow_id, status, requested_at DESC);

-- ---------------------------------------------------------------------------
-- workers
-- Registered worker instances. Heartbeat keeps this table live.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workers (
    id                TEXT        NOT NULL PRIMARY KEY,
    workspace_id      UUID,
    environment_id    UUID,
    name              TEXT        NOT NULL,
    status            TEXT        NOT NULL DEFAULT 'idle',
    queue             TEXT        NOT NULL,
    capacity          INTEGER     NOT NULL DEFAULT 10,
    active_tasks      INTEGER     NOT NULL DEFAULT 0,
    last_heartbeat_at TIMESTAMPTZ,
    version           TEXT,
    region            TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workers_status ON workers (status, last_heartbeat_at DESC);

-- ---------------------------------------------------------------------------
-- schedules
-- Cron-based workflow triggers managed by the scheduler.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedules (
    id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id     UUID        NOT NULL,
    environment_id   UUID        NOT NULL,
    workflow_id      UUID        NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
    cron_expression  TEXT        NOT NULL,
    timezone         TEXT        NOT NULL DEFAULT 'UTC',
    enabled          BOOLEAN     NOT NULL DEFAULT true,
    next_fire_at     TIMESTAMPTZ,
    last_fire_at     TIMESTAMPTZ,
    overlap_policy   TEXT        NOT NULL DEFAULT 'skip',
    misfire_policy   TEXT        NOT NULL DEFAULT 'fire_once',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schedules_workspace_id ON schedules (workspace_id);
CREATE INDEX IF NOT EXISTS idx_schedules_workflow_id  ON schedules (workflow_id);
CREATE INDEX IF NOT EXISTS idx_schedules_next_fire    ON schedules (next_fire_at) WHERE enabled = true;

-- ---------------------------------------------------------------------------
-- Worker auxiliary tables
-- Created by worker ensureTable() calls on startup. Included here so a
-- fresh manual schema run produces a complete database.
-- ---------------------------------------------------------------------------

-- step_outputs: raw/extracted/validated output per node per run
CREATE TABLE IF NOT EXISTS step_outputs (
    id                              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id                          UUID        NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    workspace_id                    UUID        NOT NULL,
    environment_id                  UUID        NOT NULL,
    node_id                         TEXT        NOT NULL,
    node_type                       TEXT        NOT NULL,
    raw_output_json_sanitized       JSONB,
    extracted_output_json_sanitized JSONB,
    validated_output_json_sanitized JSONB,
    validation_errors_json          JSONB,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_step_outputs_run_id ON step_outputs (run_id);

-- run_approvals: worker-side approval gate records (separate from API approvals table)
CREATE TABLE IF NOT EXISTS run_approvals (
    id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    run_id           UUID        NOT NULL,
    workspace_id     UUID        NOT NULL,
    environment_id   UUID        NOT NULL,
    node_id          TEXT        NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'PENDING',
    message          TEXT,
    metadata_json    JSONB,
    resolved_by      TEXT,
    resolved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_approvals_run_status ON run_approvals (run_id, status);

-- connection_secrets: flat key-value store for SecretService ref lookups
CREATE TABLE IF NOT EXISTS connection_secrets (
    ref             TEXT        NOT NULL PRIMARY KEY,
    encrypted_value TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- Flyway baseline
-- Insert this row so the API (RUN_MIGRATIONS=false) treats V001 as already run.
-- =============================================================================
CREATE TABLE IF NOT EXISTS flyway_schema_history (
    installed_rank  INTEGER      NOT NULL PRIMARY KEY,
    version         VARCHAR(50),
    description     VARCHAR(200) NOT NULL,
    type            VARCHAR(20)  NOT NULL,
    script          VARCHAR(1000) NOT NULL,
    checksum        INTEGER,
    installed_by    VARCHAR(100) NOT NULL,
    installed_on    TIMESTAMP    NOT NULL DEFAULT now(),
    execution_time  INTEGER      NOT NULL,
    success         BOOLEAN      NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flyway_schema_history_s ON flyway_schema_history (success);

INSERT INTO flyway_schema_history
    (installed_rank, version, description, type, script, checksum, installed_by, execution_time, success)
VALUES
    (1, '001', 'initial schema (manual baseline)', 'SQL',
     'V001__initial_schema.sql', NULL, 'manual', 0, true)
ON CONFLICT (installed_rank) DO NOTHING;

-- =============================================================================
-- DONE — Tables created:
--   workspaces, environments
--   connections, encrypted_secrets
--   agents, tools
--   workflows, workflow_versions
--   agent_runs, run_events, run_event_logs
--   run_checkpoints, approvals
--   workers, schedules
--   step_outputs, run_approvals, connection_secrets  (worker auxiliary)
--   flyway_schema_history
-- =============================================================================
