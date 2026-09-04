-- V051 — record how many spans a run lost, so the Debug tab can stop guessing.
--
-- ── THE BUG THIS EXISTS TO END ─────────────────────────────────────────────
-- The tab showed an amber banner saying spans "were dropped while the writer was
-- under pressure". It had no signal for that. The flag behind it was
--
--     traceComplete = spans.none { kind == "run" && status == "running" }
--
-- which asks "is the run span still open" and says nothing whatever about drops.
-- On a completed run it fired anyway, because the run span was written twice —
-- once open, once closed — so the open row was always present. A warning that
-- fires on healthy runs teaches people to ignore warnings.
--
-- Drops are real and worth reporting; they were simply never counted. SpanWriter
-- has always had an in-memory `droppedCount()` that nothing read, and it dies
-- with the process, so "after the fact" needs somewhere durable.
--
-- ── WHY A COLUMN AND NOT A TABLE ───────────────────────────────────────────
-- One integer per run, written only when something was actually lost, read on
-- every trace load. A side table would be a join on the hot path to answer a
-- question that is almost always "zero".
--
-- Defaulted, not nullable-with-meaning: NULL and 0 would both have to be read as
-- "nothing dropped", and a column with two spellings of the same fact is a
-- column two readers will disagree about. Old rows get 0 — which is a claim
-- about our records, not about the run, and §12 already says an absent trace is
-- reported as `partial` rather than `complete`.

ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS dropped_spans INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN agent_runs.dropped_spans IS
    'Spans this run produced that were never persisted — dropped under buffer '
    'pressure or lost to a failed write. Incremented by SpanWriter as it drops. '
    'Non-zero puts the run''s trace in the `partial` completeness state, which is '
    'the only thing that may claim spans are missing.';
