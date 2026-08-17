-- V025 — the guards that turn a stress test into graceful degradation.
--
-- Additive only: new columns with defaults, new indexes. Nothing changes type or
-- nullability, so this is safe to apply ahead of the code that reads it and safe
-- to leave in place if that code is rolled back.
--
-- Five groups, one per guard:
--   1. per-run accumulators   — what a run has consumed so far
--   2. per-plan ceilings      — what it is allowed to consume
--   3. connection circuit     — fail fast on a provider that is down
--   4. schedule anti-stampede — deterministic jitter and overlap policy
--   5. rate limits            — per-workspace run creation

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Per-run accumulators
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A ceiling can only be enforced continuously if the total survives a yield.
-- A run executes as a sequence of bounded ticks — possibly on different workers,
-- possibly hours apart across a suspension — so the counters have to live on the
-- row, not in the tracker. In-memory counters would reset at every RESUME_RUN and
-- an infinite agent loop would never reach its step ceiling.

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS steps_executed  INTEGER NOT NULL DEFAULT 0,
    -- Milliseconds actually executing. NOT (completed_at - started_at): a run
    -- waiting on an approval or a durable timer is suspended, holds no permit and
    -- costs nothing, so charging it wall-clock time would kill long-lived
    -- workflows for being patient.
    ADD COLUMN IF NOT EXISTS active_ms       BIGINT  NOT NULL DEFAULT 0,
    -- Integer cents, not a float. Money compared with `>=` must not carry binary
    -- rounding error, and `estimated_cost NUMERIC` above is the reporting figure
    -- rather than the enforcement one.
    ADD COLUMN IF NOT EXISTS cost_cents      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tokens_used     INTEGER NOT NULL DEFAULT 0,
    -- Which ceiling stopped it, for the terminal error message and for the
    -- "why did my run stop" question the UI has to answer without a support
    -- ticket. NULL for every run that finished on its own terms.
    ADD COLUMN IF NOT EXISTS ceiling_breached TEXT;

COMMENT ON COLUMN agent_runs.active_ms IS
    'Milliseconds of active execution, accumulated per tick. Excludes suspension '
    '(approvals, timers, retry backoff) — those hold no worker permit.';
COMMENT ON COLUMN agent_runs.ceiling_breached IS
    'Which run-level ceiling ended this run: steps | duration | cost | tokens | payload. '
    'NULL when the run ended on its own terms.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Per-plan ceilings
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Defaults match the documented beta policy. A workspace with no policy row still
-- gets platform defaults from the worker's environment, so these are the
-- per-plan override rather than the only source.

ALTER TABLE workspace_usage_policies
    ADD COLUMN IF NOT EXISTS max_steps_per_run        INTEGER NOT NULL DEFAULT 200,
    ADD COLUMN IF NOT EXISTS max_active_seconds       INTEGER NOT NULL DEFAULT 3600,
    ADD COLUMN IF NOT EXISTS max_cost_cents_per_run   INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS max_tokens_per_run       INTEGER NOT NULL DEFAULT 1000000,
    ADD COLUMN IF NOT EXISTS max_node_payload_bytes   INTEGER NOT NULL DEFAULT 262144,
    -- Token bucket for run creation. Burst is what makes a bucket a bucket: a
    -- workspace that has been idle may spend accumulated capacity at once, which
    -- is the behaviour a fixed window cannot express.
    ADD COLUMN IF NOT EXISTS max_runs_per_minute      INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS runs_per_minute_burst    INTEGER NOT NULL DEFAULT 120;

COMMENT ON COLUMN workspace_usage_policies.max_cost_cents_per_run IS
    'Hard stop in integer cents. Default 100 = $1.00.';
COMMENT ON COLUMN workspace_usage_policies.max_node_payload_bytes IS
    'Inline payload ceiling per node. Default 262144 = 256KB; larger offloads to object storage.';

-- The demo lane's reserved budget. V023 added the column with default 0; §5 of
-- the degradation spec calls for 20 reserved slots for a priority-lane workspace.
-- Only workspaces already flagged priority_lane are touched, so this does not
-- silently reserve capacity for anyone else.
UPDATE workspace_usage_policies
   SET reserved_slots = 20
 WHERE priority_lane = true AND reserved_slots = 0;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Connection circuit breaker
-- ═══════════════════════════════════════════════════════════════════════════
--
-- State lives in Postgres rather than only in Redis because it is a
-- *user-visible* property: the Connections page shows an unhealthy connection and
-- its blast radius. A breaker whose state only exists in a worker's memory can
-- protect the fleet but cannot tell anybody why their workflow is failing.

ALTER TABLE connections
    ADD COLUMN IF NOT EXISTS circuit_state         TEXT    NOT NULL DEFAULT 'closed',
    ADD COLUMN IF NOT EXISTS consecutive_failures  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS circuit_opened_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS circuit_last_error    TEXT,
    -- Outbound calls per second this connection is allowed, from the provider's
    -- documented limits. NULL means unlimited — the correct default, because
    -- guessing a limit we were not told is worse than not limiting.
    ADD COLUMN IF NOT EXISTS max_calls_per_second  INTEGER;

DO $$ BEGIN
    ALTER TABLE connections ADD CONSTRAINT connections_circuit_state_check
        CHECK (circuit_state IN ('closed', 'open', 'half_open'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The Connections blast-radius view asks "which of my connections are unhealthy",
-- so index the answer rather than scanning.
CREATE INDEX IF NOT EXISTS connections_circuit_open_idx
    ON connections (workspace_id, circuit_opened_at)
    WHERE circuit_state <> 'closed';

COMMENT ON COLUMN connections.circuit_state IS
    'closed = calls flow; open = failing fast during cooldown; half_open = one probe in flight.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Schedule anti-stampede
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Ten schedules set to 09:00 fire at 09:00. Jitter spreads them, but it has to be
-- *deterministic* per workflow: a random offset per tick would make a schedule
-- fire at a different second each day, and "why did my 09:00 report arrive at
-- 09:00:43 today and 09:00:12 yesterday" is a worse problem than the stampede.
--
-- Derived from workflow_id, so it is stable forever and spread across the fleet
-- without any coordination. Materialised rather than computed at read time so it
-- is visible in the UI and can be overridden per schedule.

ALTER TABLE schedules
    ADD COLUMN IF NOT EXISTS jitter_seconds  INTEGER NOT NULL DEFAULT 0,
    -- Set while a run fired by this schedule is still in flight. This is what
    -- makes overlap_policy='skip' enforceable — without it, "is the previous run
    -- still going" is a join nobody performs on the hot path.
    ADD COLUMN IF NOT EXISTS active_run_id   UUID;

-- Backfill: hash the workflow id into [0, 60). Same function the scheduler uses,
-- so an existing schedule keeps the offset it is about to be given rather than
-- jumping once on first fire.
UPDATE schedules
   SET jitter_seconds = ('x' || substr(md5(workflow_id::text), 1, 8))::bit(32)::bigint % 60
 WHERE jitter_seconds = 0;

DO $$ BEGIN
    ALTER TABLE schedules ADD CONSTRAINT schedules_overlap_policy_check
        CHECK (overlap_policy IN ('skip', 'queue', 'allow_concurrent'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN schedules.jitter_seconds IS
    'Deterministic 0-59s offset derived from workflow_id. Stable per workflow, spread across the fleet.';
COMMENT ON COLUMN schedules.overlap_policy IS
    'skip = do not fire while the previous run is in flight; queue = fire anyway and let '
    'admission order it; allow_concurrent = no check.';
