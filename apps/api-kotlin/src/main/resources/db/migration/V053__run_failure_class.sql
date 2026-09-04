-- The failure class, on the run that failed.
--
-- ── WHY THIS IS DENORMALISED AND NOT A JOIN ─────────────────────────────────
-- A run's class lives on its root-cause SPAN today (`run_spans.failure_class`,
-- written from `StopReasonTaxonomy`). Answering "how did this workspace fail
-- last week" therefore means, for every failed run, finding its root-cause span
-- and reading a column off it.
--
-- That is a join from `agent_runs` into a partitioned `run_spans` with no index
-- on `is_root_cause`, once per run. At the hundred-thousand-run window the
-- failures page is specified to load in under a second, it is not close.
--
-- It also fixes a correctness problem, which matters more. Only ACTIVATION spans
-- carry a class, so a run that failed in an HTTP node has no classified span at
-- all — and "every failed run appears in exactly one class" is impossible while
-- the class is a property of a span that may not exist. Written on the run at
-- terminalisation, every failed run gets exactly one, including the explicit
-- UNCLASSIFIED for the ones nothing could classify.
ALTER TABLE agent_runs
    ADD COLUMN IF NOT EXISTS failure_class TEXT;

COMMENT ON COLUMN agent_runs.failure_class IS
    'Taxonomy class of this run''s failure (see observability-kotlin FailureClass), '
    'or UNCLASSIFIED when the run failed and nothing could classify it. NULL means '
    'the run did not fail, or predates this column.';

-- ── THE ROLL-UP''S INDEX ─────────────────────────────────────────────────────
--
-- The page groups by class over a time window inside one workspace, so the index
-- leads with the workspace, then the window, and carries the class as a payload
-- column.
--
-- Partial on `failure_class IS NOT NULL`: the page is about failures, and a
-- workspace''s successes are usually the overwhelming majority of its rows.
--
-- ── WHEN THE PLANNER WILL AND WILL NOT USE IT ───────────────────────────────
-- Measured: on a table where ONE workspace owns nearly every row, Postgres picks
-- a parallel sequential scan and is right to — the workspace predicate selects
-- everything, so there is nothing for an index to narrow, and the aggregate
-- still returns in ~80ms over 100,000 runs.
--
-- This index is for the production shape, where a workspace is a small slice of
-- a shared table and the window is a small slice of its history. It is recorded
-- here rather than asserted in a test, because a test that pins the plan pins
-- the fixture''s selectivity rather than the query''s correctness.
CREATE INDEX IF NOT EXISTS agent_runs_failures_idx
    ON agent_runs (workspace_id, created_at DESC)
    INCLUDE (failure_class, workflow_id, status)
    WHERE failure_class IS NOT NULL;
