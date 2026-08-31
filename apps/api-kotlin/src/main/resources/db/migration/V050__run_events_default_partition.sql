-- V050 — a DEFAULT partition for run_events, and the corrected run_event_seq comment.
--
-- ── WHY run_events NEEDS WHAT run_spans ALREADY HAS ────────────────────────
-- V041 gave `run_spans` a DEFAULT partition; `run_events` never had one. V028's
-- `run_events_historical` covers everything BEFORE its boundary, and nothing
-- covers a month past the last pre-created one — an INSERT there does not
-- degrade, it errors: "no partition of relation run_events found for row".
--
-- `PartitionMaintenance` exists to keep that from happening and runs hourly. A
-- DEFAULT partition is the backstop for the hour it is wrong: a missed month
-- lands on the slow path instead of failing the write, and
-- `run_spans_default_partition_rows()` has an analogue here so it is visible
-- rather than silent.
--
-- ── AND THE REASON IT IS URGENT NOW ────────────────────────────────────────
-- Event writes are BATCHED since §12.2. A missing partition used to fail one
-- insert; it now fails a block of up to fifty, and the 23505 retry does not
-- apply because the error is not a unique violation. The blast radius grew by
-- 50x while the failure mode stayed the same.

CREATE TABLE IF NOT EXISTS run_events_default PARTITION OF run_events DEFAULT;

COMMENT ON TABLE run_events_default IS
    'Backstop for a month PartitionMaintenance failed to pre-create. Rows here are '
    'correct but unindexed by partition pruning; anything in it means the maintenance '
    'job is not running. Watch run_events_default_partition_rows().';

-- Mirrors run_spans_default_partition_rows(), so one alert covers both tables.
CREATE OR REPLACE FUNCTION run_events_default_partition_rows()
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    n BIGINT;
BEGIN
    IF to_regclass('run_events_default') IS NULL THEN RETURN 0; END IF;
    EXECUTE 'SELECT count(*) FROM run_events_default' INTO n;
    RETURN n;
END;
$$;

-- ── V046's table comment claimed a pruner that nothing called ──────────────
-- The function existed; no Kotlin ever invoked it. `PartitionMaintenance` calls
-- it now, so the comment is true — but it was written before it was, which is
-- exactly the failure V028 had twice. Restated here rather than by editing V046,
-- which is applied and therefore immutable.
COMMENT ON TABLE run_event_seq IS
    'Per-run event sequence counter, so event writes stop contending with agent_runs '
    'status/lease updates. Deliberately has NO foreign key to agent_runs: both event '
    'stores tolerate appending to a run whose row is gone, and an FK would turn that '
    'tolerated case into a failed write. Pruned by run_event_seq_prune(), called '
    'hourly from PartitionMaintenance.';
