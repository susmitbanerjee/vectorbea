-- What the warm tier LEFT OUT, recorded beside what it kept.
--
-- ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
-- V047's header states the point of this table plainly: it "is the only remaining
-- evidence that the rows ever existed", which is why it carries the row count and
-- the byte count rather than just a key.
--
-- Since TraceSampler was wired at the archive boundary that stopped being true.
-- `row_count` is the number of rows in the OBJECT, and the sampler decides, per
-- logical trace, that some runs' spans are not worth keeping. Those runs' spans
-- are then not in the object, not in the count, and — once the partition is
-- dropped — not anywhere. The ledger recorded what was kept and said nothing
-- about what was dropped, so the difference was unobservable by construction.
--
-- `TraceArchiver.Archived.sampledOutRuns` has been computed the whole time and
-- discarded at the end of the method.
--
-- ── WHY RUNS AND NOT ROWS ───────────────────────────────────────────────────
-- The sampler's unit is a run — strictly, a whole trace tree, decided once at the
-- root and applied to every run under it. It never keeps part of a run.
--
-- Counting the excluded ROWS would need a second pass over the partition purely
-- to count what is about to be skipped, which is a full scan of a month to
-- produce a number nobody would query. The run count is what answers the question
-- somebody actually asks — "is this trace missing because it was sampled out, or
-- because it never existed" — and it is free, because the exporter already holds
-- the list.
--
-- ── SKEW ────────────────────────────────────────────────────────────────────
-- NOT NULL with a default, so a worker that predates this migration keeps
-- inserting successfully. 0 on an old row is honest for the fleet this ships to:
-- `trace_sample_rate` defaults to 1.000 and TraceArchiver's sampler defaults to
-- null, so nothing has been sampled out yet anywhere. The worker also probes for
-- this column before using it, because the reverse skew — new worker, old
-- database — must not fail an export.
ALTER TABLE run_trace_archives
    ADD COLUMN IF NOT EXISTS sampled_out_runs BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN run_trace_archives.sampled_out_runs IS
    'Runs whose spans TraceSampler excluded from this object. Their spans are in '
    'neither the archive nor (after the drop) Postgres. 0 means nothing was '
    'sampled out, which is the default configuration everywhere.';

COMMENT ON COLUMN run_trace_archives.row_count IS
    'Rows in the exported object — NOT the rows the partition held. The two differ '
    'by whatever sampled_out_runs accounts for.';

-- Partitions that lost runs to sampling.
--
-- A view rather than a note in a runbook: "which months are incomplete, and by
-- how much" is asked during an investigation, when nobody is going to reconstruct
-- the predicate. Ordered worst-first because the question is always about the
-- worst one.
CREATE OR REPLACE VIEW run_trace_archives_reduced AS
    SELECT source_table, partition_name, period_start, period_end,
           row_count, sampled_out_runs, tier, exported_at, dropped_at
      FROM run_trace_archives
     WHERE sampled_out_runs > 0
     ORDER BY sampled_out_runs DESC;

COMMENT ON VIEW run_trace_archives_reduced IS
    'Archived partitions where sampling dropped at least one run. A trace absent '
    'from one of these months may have been sampled out rather than never recorded.';
