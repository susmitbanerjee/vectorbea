-- =============================================================================
-- V009__durable_execution.sql
-- Production-grade durable execution tables for long-running workflows.
--
-- 1. agent_runs: history tracking + continue-as-new + new statuses
-- 2. run_continuations: links old→new runs in a continue-as-new chain
-- 3. workflow_timers: durable timer rows (no worker thread sleeping)
-- 4. run_leases: crash recovery via lease acquisition/expiry detection
-- 5. step_executions: idempotent node execution tracking
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. agent_runs: history tracking + continuation links + new statuses
-- ---------------------------------------------------------------------------

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS history_event_count      INTEGER   NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS history_size_bytes        BIGINT    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS history_warning_issued    BOOLEAN   NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS continue_as_new_recommended BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS continue_as_new_required  BOOLEAN   NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS continued_from_run_id     UUID      REFERENCES agent_runs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS continued_to_run_id       UUID      REFERENCES agent_runs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS continuation_sequence     INTEGER   NOT NULL DEFAULT 0;

-- New status values added by this migration:
--   WAITING_FOR_TIMER    - run paused, durable timer scheduled
--   CONTINUED_AS_NEW     - run completed, continued as new run
--   RECOVERING           - stale run being recovered after worker crash
-- These are enforced at the application layer; Postgres stores them as TEXT.

CREATE INDEX IF NOT EXISTS idx_agent_runs_continued_from
    ON agent_runs (continued_from_run_id)
    WHERE continued_from_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_history_warning
    ON agent_runs (workspace_id, history_warning_issued)
    WHERE history_warning_issued = true;

-- ---------------------------------------------------------------------------
-- 2. run_continuations: continuation chain metadata + compact carry-over state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_continuations (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id            UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id          UUID        NOT NULL,
    old_run_id              UUID        NOT NULL REFERENCES agent_runs(id),
    new_run_id              UUID        NOT NULL REFERENCES agent_runs(id),
    workflow_id             UUID        NOT NULL,
    workflow_version_id     UUID        NOT NULL,
    continuation_sequence   INTEGER     NOT NULL DEFAULT 1,
    reason                  TEXT        NOT NULL,   -- 'history_limit' | 'manual' | 'workflow_policy'
    state_json_sanitized    JSONB       NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_run_continuations_old_run
    ON run_continuations (workspace_id, old_run_id);
CREATE INDEX IF NOT EXISTS idx_run_continuations_new_run
    ON run_continuations (workspace_id, new_run_id);

-- ---------------------------------------------------------------------------
-- 3. workflow_timers: durable timer rows — worker does not sleep
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_timers (
    id                          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id                UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id              UUID        NOT NULL,
    run_id                      UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    workflow_id                 UUID        NOT NULL,
    node_id                     TEXT        NOT NULL,
    fire_at                     TIMESTAMPTZ NOT NULL,
    status                      TEXT        NOT NULL DEFAULT 'scheduled',  -- scheduled | fired | cancelled
    payload_json_sanitized      JSONB       NOT NULL DEFAULT '{}',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    fired_at                    TIMESTAMPTZ,
    CONSTRAINT workflow_timers_status_check CHECK (status IN ('scheduled','fired','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_timers_due
    ON workflow_timers (fire_at, status)
    WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_workflow_timers_run
    ON workflow_timers (workspace_id, run_id);

-- ---------------------------------------------------------------------------
-- 4. run_leases: crash recovery via lease expiry detection
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_leases (
    id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    run_id          UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    worker_id       TEXT        NOT NULL,
    lease_token     TEXT        NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    renewed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id)   -- one lease per run at a time
);

CREATE INDEX IF NOT EXISTS idx_run_leases_expires
    ON run_leases (expires_at)
    WHERE expires_at < now() + INTERVAL '5 minutes';
CREATE INDEX IF NOT EXISTS idx_run_leases_worker
    ON run_leases (worker_id);

-- ---------------------------------------------------------------------------
-- 5. step_executions: idempotent node execution — guards against duplicate work
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS step_executions (
    id                      UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id            UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    environment_id          UUID        NOT NULL,
    run_id                  UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    node_id                 TEXT        NOT NULL,
    attempt                 INTEGER     NOT NULL DEFAULT 0,
    status                  TEXT        NOT NULL DEFAULT 'running',  -- running | succeeded | failed | skipped
    idempotency_key         TEXT,
    started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at            TIMESTAMPTZ,
    error_json_sanitized    JSONB,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (run_id, node_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_step_executions_run
    ON step_executions (workspace_id, run_id);
CREATE INDEX IF NOT EXISTS idx_step_executions_idempotency
    ON step_executions (workspace_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. workflow_versions: continuation policy
-- ---------------------------------------------------------------------------
ALTER TABLE workflow_versions
    ADD COLUMN IF NOT EXISTS continuation_policy_json JSONB NOT NULL DEFAULT '{
        "enabled": true,
        "mode": "auto_before_limit",
        "eventWarningThreshold": 10240,
        "eventMaxThreshold": 51200,
        "sizeWarningBytes": 10485760,
        "sizeMaxBytes": 52428800,
        "carryStateStrategy": "compact_context",
        "stateKeys": [],
        "useLatestWorkflowVersion": false
    }';
