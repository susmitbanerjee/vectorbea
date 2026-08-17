-- =============================================================================
-- V022__exactly_once_guards.sql
--
-- The queue delivers at-least-once. The product sends emails, writes to customer
-- databases, and acts on users' behalf. Without the guards below a redelivery
-- sends the email twice, and that is a customer-visible incident rather than a
-- bug report.
--
-- Three mechanisms, each closing a different window:
--
--   fencing        a worker whose lease was reclaimed mid-flight must not be
--                  able to write anything, anywhere (09 §6.3)
--   idempotency    an external call that already happened must not happen again,
--                  even if the worker died between the call and the state write
--   dead letter    a job that crashes its worker must stop being redelivered
--                  before it crashes every worker in the fleet, forever
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. side_effects — the record of external calls
--
-- The dangerous window is between "call succeeded" and "state written". A crash
-- there leaves the side effect done and the system believing it is not, so the
-- retry repeats it. This table closes that window by recording the intent
-- BEFORE the call and the response AFTER it, keyed deterministically so a retry
-- of the same logical operation finds the existing row.
--
-- Status is the whole protocol:
--   in_flight  a call is happening right now, or a worker died mid-call
--   succeeded  the call completed; response_json is authoritative, do not repeat
--   failed     the call genuinely failed; a retry is legitimate
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS side_effects (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id        UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    run_id              UUID        NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    node_id             TEXT        NOT NULL,

    -- Deterministic key over (run_id, node_id, attempt_group). See the
    -- attempt_group note below — this is the field that makes a retry share a
    -- key with the operation it retries, while a user-initiated re-run does not.
    idempotency_key     TEXT        NOT NULL,

    -- What kind of effect: http | email | db_write | llm. Diagnostic only.
    effect_type         TEXT        NOT NULL DEFAULT 'http',
    -- Coarse target for incident triage (host, or provider name). Never a URL
    -- with a query string, which can carry secrets.
    target              TEXT,

    status              TEXT        NOT NULL DEFAULT 'in_flight',

    -- The stored response, replayed verbatim on a dedupe hit so the workflow
    -- sees exactly what it saw the first time.
    response_json       JSONB,
    error_json          JSONB,

    -- Which worker/lease performed it. Answers "who sent that email?" during an
    -- incident, and lets a stuck in_flight row be attributed to a dead worker.
    worker_id           TEXT,
    lease_token         TEXT,

    attempt_group       INTEGER     NOT NULL DEFAULT 0,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT side_effects_status_chk
        CHECK (status IN ('in_flight', 'succeeded', 'failed'))
);

-- THE constraint. Everything else here is bookkeeping; this is what makes the
-- protocol work. The INSERT either wins (this attempt performs the call) or
-- conflicts (someone already did, or is doing, this exact operation).
--
-- Scoped by workspace as well as key so a guessed or colliding key from one
-- workspace can never suppress another workspace's call.
CREATE UNIQUE INDEX IF NOT EXISTS side_effects_key_uniq
    ON side_effects (workspace_id, idempotency_key);

CREATE INDEX IF NOT EXISTS side_effects_run_idx
    ON side_effects (run_id, node_id);

-- Finds in_flight rows abandoned by a dead worker, for the sweeper.
CREATE INDEX IF NOT EXISTS side_effects_stuck_idx
    ON side_effects (status, started_at)
    WHERE status = 'in_flight';

COMMENT ON TABLE side_effects IS
    'One row per external side effect, keyed deterministically by '
    '(run_id, node_id, attempt_group). Written BEFORE the call and completed '
    'after, so a crash in between is detectable rather than silently repeated.';

-- ---------------------------------------------------------------------------
-- 2. attempt_group on step_executions
--
-- attempt increments on every retry, including automatic ones. If the
-- idempotency key were derived from it, every retry would get a fresh key and
-- repeat the side effect — precisely the bug being prevented.
--
-- attempt_group increments only when a human asks for the work to happen again
-- (a re-run, a replay). So: retries of the same logical operation share a key;
-- a deliberate re-run does not, because the user is asking for the email to be
-- sent again.
-- ---------------------------------------------------------------------------
ALTER TABLE step_executions
    ADD COLUMN IF NOT EXISTS attempt_group INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN step_executions.attempt_group IS
    'Increments on user-initiated re-runs only, never on automatic retries. '
    'The idempotency key is derived from this, not from attempt.';

-- ---------------------------------------------------------------------------
-- 3. dead_letters — poison job protection
--
-- A job that crashes the worker gets reclaimed and crashes the next one. Left
-- alone that is a fleet-wide outage caused by one malformed payload. Past
-- max_attempts the job stops being redelivered and lands here instead, with
-- enough context to diagnose it without reproducing the crash.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dead_letters (
    id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id        UUID,
    environment_id      UUID,
    run_id              UUID,
    workflow_id         UUID,

    job_type            TEXT,
    execution_class     TEXT,

    -- The full message, so the job can be replayed by hand after a fix.
    payload_json        JSONB       NOT NULL DEFAULT '{}',

    -- Every error across every attempt, in order. One error tells you the last
    -- failure; the chain tells you whether it is deterministic — which is the
    -- difference between a poison payload and a flaky dependency.
    error_chain_json    JSONB       NOT NULL DEFAULT '[]',

    attempts            INTEGER     NOT NULL DEFAULT 0,
    max_attempts        INTEGER     NOT NULL DEFAULT 5,
    reason              TEXT        NOT NULL,

    -- Which workers it killed, and what they were.
    worker_context_json JSONB       NOT NULL DEFAULT '{}',

    -- Operator workflow: new -> acknowledged -> replayed | discarded
    status              TEXT        NOT NULL DEFAULT 'new',
    acknowledged_by     TEXT,
    acknowledged_at     TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT dead_letters_status_chk
        CHECK (status IN ('new', 'acknowledged', 'replayed', 'discarded'))
);

CREATE INDEX IF NOT EXISTS dead_letters_workspace_idx
    ON dead_letters (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dead_letters_open_idx
    ON dead_letters (status, created_at DESC)
    WHERE status IN ('new', 'acknowledged');
CREATE INDEX IF NOT EXISTS dead_letters_run_idx
    ON dead_letters (run_id);

COMMENT ON TABLE dead_letters IS
    'Jobs that exceeded max_attempts. Surfaced in the Incidents UI with full '
    'payload and error chain so a poison job can be diagnosed without '
    'reproducing the crash that produced it.';

-- ---------------------------------------------------------------------------
-- 4. Attempt tracking on the run
--
-- Needed to decide when a job has exhausted its attempts. The Redis message
-- carries a retryCount, but a message can be redelivered without that counter
-- advancing (an XAUTOCLAIM reclaim replays the original fields), so the
-- authoritative count has to live in Postgres alongside the run.
-- ---------------------------------------------------------------------------
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS attempt_group     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dead_lettered_at  TIMESTAMPTZ;

COMMENT ON COLUMN agent_runs.delivery_attempts IS
    'Times this run has been claimed by a worker. Authoritative in Postgres '
    'because a reclaimed Redis message replays its original retryCount.';
