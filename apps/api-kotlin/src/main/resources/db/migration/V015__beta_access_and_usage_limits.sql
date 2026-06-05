-- =============================================================================
-- V015__beta_access_and_usage_limits.sql
-- Production private beta: access control, usage policies, onboarding tables.
-- =============================================================================

-- ── Beta status on app_users ──────────────────────────────────────────────────
ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS beta_status TEXT NOT NULL DEFAULT 'waitlisted'
        CHECK (beta_status IN ('waitlisted','invited','approved','rejected','disabled')),
    ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Existing users (pre-beta migration) are approved so they retain access
UPDATE app_users SET beta_status = 'approved' WHERE beta_status = 'waitlisted';

-- ── Beta applications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beta_applications (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    supabase_user_id    UUID,
    app_user_id         UUID        REFERENCES app_users(id),
    email               TEXT        NOT NULL,
    full_name           TEXT,
    company_name        TEXT,
    role_title          TEXT,
    use_case            TEXT,
    current_tools       TEXT,
    pain_point          TEXT,
    workflows_per_week  TEXT,
    team_size           TEXT,
    byok_ready          BOOLEAN,
    notes               TEXT,
    status              TEXT        NOT NULL DEFAULT 'waitlisted'
        CHECK (status IN ('waitlisted','invited','approved','rejected','disabled')),
    reviewed_by_user_id UUID,
    reviewed_at         TIMESTAMPTZ,
    decision_reason     TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_beta_apps_status ON beta_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_beta_apps_email  ON beta_applications (email);

-- ── Workspace beta controls ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_beta_controls (
    id                    UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id          UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    access_status         TEXT        NOT NULL DEFAULT 'approved'
        CHECK (access_status IN ('pending','approved','rejected','disabled')),
    execution_mode        TEXT        NOT NULL DEFAULT 'simulation_only'
        CHECK (execution_mode IN ('simulation_only','real_execution_enabled','disabled')),
    real_execution_enabled BOOLEAN   NOT NULL DEFAULT false,
    simulation_enabled    BOOLEAN    NOT NULL DEFAULT true,
    admin_notes           TEXT,
    approved_by_user_id   UUID,
    approved_at           TIMESTAMPTZ,
    disabled_reason       TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_wbc_workspace ON workspace_beta_controls (workspace_id);

-- Backfill existing workspaces with approved controls
INSERT INTO workspace_beta_controls (workspace_id, access_status, execution_mode, real_execution_enabled)
SELECT id, 'approved', 'simulation_only', false
FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- ── Workspace usage policies ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_usage_policies (
    id                          UUID    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id                UUID    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    max_workflows               INTEGER NOT NULL DEFAULT 3,
    max_runs_per_day            INTEGER NOT NULL DEFAULT 20,
    max_steps_per_workflow      INTEGER NOT NULL DEFAULT 5,
    max_parallel_branches       INTEGER NOT NULL DEFAULT 1,
    max_run_duration_seconds    INTEGER NOT NULL DEFAULT 300,
    max_events_per_run          INTEGER NOT NULL DEFAULT 1000,
    log_retention_days          INTEGER NOT NULL DEFAULT 7,
    artifact_retention_days     INTEGER NOT NULL DEFAULT 7,
    max_llm_providers           INTEGER NOT NULL DEFAULT 1,
    max_team_members            INTEGER NOT NULL DEFAULT 1,
    allow_schedules             BOOLEAN NOT NULL DEFAULT false,
    allow_webhooks              BOOLEAN NOT NULL DEFAULT false,
    allow_private_workers       BOOLEAN NOT NULL DEFAULT false,
    allow_self_correction       BOOLEAN NOT NULL DEFAULT false,
    allow_real_db_writes        BOOLEAN NOT NULL DEFAULT false,
    allow_iterative_agents      BOOLEAN NOT NULL DEFAULT false,
    allow_ai_architect          BOOLEAN NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_wup_workspace ON workspace_usage_policies (workspace_id);

-- Backfill existing workspaces with default policies
INSERT INTO workspace_usage_policies (workspace_id)
SELECT id FROM workspaces
ON CONFLICT (workspace_id) DO NOTHING;

-- ── Daily workspace usage counters ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_workspace_usage (
    id                      UUID    NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id            UUID    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    usage_date              DATE    NOT NULL,
    workflow_runs           INTEGER NOT NULL DEFAULT 0,
    simulation_runs         INTEGER NOT NULL DEFAULT 0,
    real_runs               INTEGER NOT NULL DEFAULT 0,
    ai_architect_requests   INTEGER NOT NULL DEFAULT 0,
    ai_architect_revisions  INTEGER NOT NULL DEFAULT 0,
    llm_calls               INTEGER NOT NULL DEFAULT 0,
    tool_calls              INTEGER NOT NULL DEFAULT 0,
    events_stored           INTEGER NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, usage_date)
);
CREATE INDEX IF NOT EXISTS idx_dwu_workspace_date ON daily_workspace_usage (workspace_id, usage_date DESC);

-- ── Usage limit change requests ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_limit_requests (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id            UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    requested_by_user_id    UUID        REFERENCES app_users(id),
    requested_change_json   JSONB       NOT NULL DEFAULT '{}',
    reason                  TEXT,
    status                  TEXT        NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','approved','rejected')),
    reviewed_by_user_id     UUID,
    reviewed_at             TIMESTAMPTZ,
    decision_reason         TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ulr_workspace ON usage_limit_requests (workspace_id, status, created_at DESC);

-- ── Add execution_mode to agent_runs ─────────────────────────────────────────
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'real'
        CHECK (execution_mode IN ('simulation','real'));
