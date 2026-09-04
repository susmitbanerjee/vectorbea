-- =============================================================================
-- V045__dispatched_children.sql
--
-- An activation that executes as its OWN run. Same durable row, same lifecycle,
-- different transport — §11.
--
-- Plus the reconciler's bookkeeping. That second part is the one that matters:
-- P0 confirmed a stored approval decision whose RESUME_RUN enqueue fails leaves
-- the run stuck forever, because crash recovery scans only ('running','yielded')
-- and a parked run is invisible to it. Dispatched children add a SECOND resume
-- trigger with exactly that failure shape, so both get one reconciler.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The parent link
-- ---------------------------------------------------------------------------

-- The run that dispatched this one. Null for every top-level run, which is
-- every row that exists today.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS parent_run_id UUID;

-- The activation this run IS. A dispatched child is not a new piece of work —
-- it is the same activation, executing somewhere else — so the row it belongs to
-- is the same row an inline child would have had.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS parent_activation_id UUID;

-- ── NO FOREIGN KEYS, DELIBERATELY ──────────────────────────────────────────
-- A run's lifecycle must not depend on its parent's row surviving. Retention
-- prunes old runs, and a CASCADE from parent to child would delete a child that
-- is still executing; a RESTRICT would make pruning a parent fail for as long as
-- any child row exists. Both are worse than a dangling id that the reconciler
-- and the trace already treat as "parent gone".

COMMENT ON COLUMN agent_runs.parent_run_id IS
    'The run that dispatched this one. Null for a top-level run. No FK: a '
    'child''s lifecycle must not depend on its parent''s row surviving retention.';

COMMENT ON COLUMN agent_runs.parent_activation_id IS
    'The activation this run IS. A dispatched child is the same activation an '
    'inline child would have been, executing on its own transport — so the '
    'agent_activations row is shared, not duplicated.';

-- The reconciler's question, asked every sweep: "are all of this parent's
-- children terminal?" Partial, because only non-terminal children matter.
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent
    ON agent_runs (parent_run_id)
    WHERE parent_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_live
    ON agent_runs (parent_run_id)
    WHERE parent_run_id IS NOT NULL
      AND status NOT IN ('succeeded','failed','cancelled');

-- ── THE SWEEP INDEX ────────────────────────────────────────────────────────
-- The reconciler scans parked runs by how long they have been parked. Partial
-- on the four parked statuses so it stays small: the overwhelming majority of
-- rows in this table are terminal and must never be walked.
--
-- All four are in the list because P0 found all four unreconciled:
--   waiting_for_approval — the confirmed gap
--   waiting_for_child    — new, and the same shape
--   recovering           — CrashRecoveryLoop marks then enqueues; if the enqueue
--                          throws, the recovery loop has stranded the run it was
--                          rescuing, and findStaleRuns does not scan 'recovering'
--   waiting_for_timer    — TimerScheduler marks the timer 'fired' BEFORE
--                          enqueueing, and findDueTimers requires 'scheduled', so
--                          a failed enqueue retries never
CREATE INDEX IF NOT EXISTS idx_agent_runs_parked
    ON agent_runs (status, updated_at)
    WHERE status IN ('waiting_for_approval','waiting_for_child','recovering','waiting_for_timer');

-- ---------------------------------------------------------------------------
-- 2. Resume attempts — the reconciler's bounded retry and dead-letter path
--
-- ── WHY A TABLE AND NOT AN IN-MEMORY COUNTER ───────────────────────────────
-- The reconciler runs on every worker. A counter in one worker's heap is a
-- counter every other worker disagrees with, so a run that has failed to resume
-- five times on worker A gets five fresh attempts from worker B, and the
-- "bounded" retry is unbounded in the size of the fleet. It also has to survive
-- the restart that a persistent enqueue failure usually accompanies.
--
-- One row per run, upserted. Not one per attempt: the interesting facts are how
-- many times and what went wrong last, and a row per attempt on a run that is
-- failing every 30 seconds is a table that grows without bound while nobody is
-- reading it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS run_resume_attempts (
    run_id          UUID        PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
    workspace_id    UUID        NOT NULL,

    -- Why this run needed reconciling. Diagnostic: four different bugs produce
    -- four different values here, and knowing which one is firing is most of the
    -- work of fixing it.
    reason          TEXT        NOT NULL,

    attempts        INTEGER     NOT NULL DEFAULT 0,
    last_error      TEXT,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- ── THE DEAD-LETTER PATH ───────────────────────────────────────────────
    -- Set when the retry budget is spent. The row STAYS — a dead-lettered
    -- resume is the only record that a run was parked and could not be revived,
    -- and deleting it would return the run to the sweep on the next tick and
    -- start the whole cycle again.
    dead_lettered_at TIMESTAMPTZ,

    CONSTRAINT run_resume_reason_check CHECK (
        reason IN ('approval_resolved','children_terminal','recovering_stranded','timer_fired')
    )
);

-- The sweep skips runs already dead-lettered, and the backoff needs the last
-- attempt time. One index covers both.
CREATE INDEX IF NOT EXISTS idx_run_resume_live
    ON run_resume_attempts (last_attempt_at)
    WHERE dead_lettered_at IS NULL;

COMMENT ON TABLE run_resume_attempts IS
    'The reconciler''s bounded retry, per run. Durable rather than in-memory '
    'because the reconciler runs on every worker: an in-heap counter gives a '
    'failing run N fresh attempts per worker, so "bounded" would scale with the '
    'fleet.';

COMMENT ON COLUMN run_resume_attempts.dead_lettered_at IS
    'Set when the retry budget is spent. The row is KEPT: it is the only record '
    'that a run was parked and could not be revived, and deleting it would put '
    'the run back in the sweep on the next tick.';

-- ---------------------------------------------------------------------------
-- 3. Fair scheduling for dispatched children
--
-- A child inherits its parent's fair_vtime plus a depth penalty. Without the
-- penalty, a tenant could jump its own queue by manufacturing children: every
-- child would enter at the parent's vtime, which is already at the head, so a
-- 20-wide fan-out would place 20 runs ahead of that tenant's other queued work
-- and the weighted-fair ordering would be defeated from inside.
--
-- The penalty is a column rather than a constant so it can be tuned without a
-- deploy, and lives on the policy row beside plan_weight because it is the same
-- kind of knob: it decides where a tenant's work sits in the queue.
-- ---------------------------------------------------------------------------
ALTER TABLE workspace_usage_policies
    ADD COLUMN IF NOT EXISTS child_vtime_penalty DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    -- One team must not occupy the whole child lane. Per RUN, so a 20-wide
    -- fan-out dispatches in waves rather than all at once.
    ADD COLUMN IF NOT EXISTS max_activations_per_run INTEGER NOT NULL DEFAULT 8,
    -- And per WORKSPACE, so ten teams cannot do together what one may not.
    ADD COLUMN IF NOT EXISTS max_activations_per_workspace INTEGER NOT NULL DEFAULT 32;

COMMENT ON COLUMN workspace_usage_policies.child_vtime_penalty IS
    'Seconds of virtual time added per depth level to a dispatched child''s '
    'fair_vtime. Stops a tenant jumping its own queue by manufacturing children: '
    'without it every child enters at the parent''s vtime, which is already at '
    'the head of the queue.';

COMMENT ON COLUMN workspace_usage_policies.max_activations_per_run IS
    'Concurrent dispatched children one run may have. A wide fan-out dispatches '
    'in waves rather than seizing the lane.';

COMMENT ON COLUMN workspace_usage_policies.max_activations_per_workspace IS
    'Concurrent dispatched children one workspace may have across all its runs, '
    'so ten teams cannot do together what one team may not.';
