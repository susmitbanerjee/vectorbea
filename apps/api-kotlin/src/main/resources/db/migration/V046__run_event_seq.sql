-- V046 — take the event sequence counter off the run row.
--
-- ── THE PROBLEM ────────────────────────────────────────────────────────────
-- `RunEventStore` (worker) and `RunEventRepository` (API) both assign
-- `run_events.sequence` under `SELECT 1 FROM agent_runs WHERE id = ? FOR UPDATE`.
-- That is CORRECT and it stays correct: it is the only thing stopping two
-- processes reading the same MAX(sequence) and writing the same number. See
-- docs/AGENT-HARNESS-ARCHITECTURE.md §12.2.
--
-- It is also a per-run serialization point on the SAME ROW that carries run
-- status, the lease, the fair-queueing vtime and the history counters. A
-- five-agent team emits hundreds of events, so every event write queues behind
-- every status update and vice versa. The lock is not the problem; the row it is
-- taken on is.
--
-- ── WHAT THIS CHANGES ──────────────────────────────────────────────────────
-- A dedicated one-column-of-state row per run. The lock still exists, still
-- serializes cluster-wide, and is still held for the insert transaction — it
-- just no longer collides with anything else that touches `agent_runs`.
--
-- ── WHY A TABLE AND NOT AN ADVISORY LOCK ───────────────────────────────────
-- §12.2 offers both. A counter row wins on two counts:
--
--   1. `pg_advisory_xact_lock(hash(run_id))` still needs `MAX(sequence)` to find
--      the next number, and that read scans every monthly partition of a
--      partitioned table for the run's rows. The counter row makes allocation a
--      single-row UPDATE that touches no partition at all.
--   2. hash(uuid) into bigint collides. Two runs sharing a hash bucket serialize
--      against each other for no reason, and the collision is invisible — it
--      shows up as unexplained latency on an unrelated run.
--
-- ── FORWARD/BACKWARD SKEW ──────────────────────────────────────────────────
-- The API and the worker deploy independently, and a mixed fleet where one side
-- allocates from this counter and the other from MAX(sequence) would write
-- duplicates. So BOTH sides read the same env flag (AGENT_EVENT_SEQ_COUNTER,
-- default off) and this table sits unused until it is turned on everywhere.
-- Migration-then-flag, never flag-in-migration.
--
-- The seeding branch below is what makes the flip safe MID-RUN: the first
-- allocation for a run that already has events starts from MAX(sequence)+1, not
-- from 1.

CREATE TABLE IF NOT EXISTS run_event_seq (
    run_id   UUID PRIMARY KEY,
    -- The next sequence number to hand out. Never decreases.
    next_seq INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE run_event_seq IS
    'Per-run event sequence counter, so event writes stop contending with agent_runs '
    'status/lease updates. Deliberately has NO foreign key to agent_runs: both event '
    'stores tolerate appending to a run whose row is gone (a run deleted mid-flight), '
    'and an FK would turn that tolerated case into a failed write. Pruned by '
    'run_event_seq_prune().';

-- Hand out a contiguous block of [p_count] sequence numbers. Returns the FIRST.
--
-- One statement, so the row lock is taken and the counter advanced atomically.
-- The caller runs this inside its insert transaction: a rollback puts the block
-- back rather than leaving a hole.
--
-- Both branches return the same thing:
--   • INSERT   — the run has no counter yet. Seed past any events already
--                written under the old MAX(sequence) scheme, so flipping the
--                flag mid-run cannot reissue a number.
--   • CONFLICT — the ordinary path. Take the row lock, advance, return.
CREATE OR REPLACE FUNCTION run_events_allocate_seq(p_run_id UUID, p_count INTEGER)
RETURNS INTEGER
LANGUAGE sql
AS $$
    INSERT INTO run_event_seq AS s (run_id, next_seq)
    VALUES (
        p_run_id,
        COALESCE((SELECT MAX(sequence) FROM run_events WHERE run_id = p_run_id), 0)
            + 1 + GREATEST(p_count, 1)
    )
    ON CONFLICT (run_id) DO UPDATE
        SET next_seq = s.next_seq + GREATEST(p_count, 1),
            updated_at = now()
    RETURNING s.next_seq - GREATEST(p_count, 1);
$$;

COMMENT ON FUNCTION run_events_allocate_seq(UUID, INTEGER) IS
    'Allocate a contiguous block of run_events.sequence values and return the first. '
    'Call inside the insert transaction so a rollback returns the block.';

-- Drop counters for runs that finished long enough ago that nothing will append
-- to them again.
--
-- NOT driven off `forgetRun` in the worker. A late cancel, an approval decision
-- or a replay can append to a run minutes after the worker considers it done,
-- and a counter deleted too early re-seeds from MAX(sequence) — which is only
-- correct while that run's partition still exists. Waiting days removes the
-- race entirely; the table is one narrow row per live run either way.
CREATE OR REPLACE FUNCTION run_event_seq_prune(p_keep_days INTEGER DEFAULT 7)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    deleted INTEGER;
BEGIN
    WITH gone AS (
        DELETE FROM run_event_seq s
        USING agent_runs r
        WHERE r.id = s.run_id
          AND r.status IN ('succeeded','failed','cancelled','timeout','ceiling_exceeded',
                           'continued_as_new','handed_off')
          AND s.updated_at < now() - make_interval(days => GREATEST(p_keep_days, 1))
        RETURNING 1
    )
    SELECT COUNT(*) INTO deleted FROM gone;
    RETURN deleted;
END;
$$;
