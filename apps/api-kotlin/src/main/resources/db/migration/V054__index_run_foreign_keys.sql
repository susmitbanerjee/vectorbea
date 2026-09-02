-- Index the foreign keys that point at `agent_runs`.
--
-- ── HOW THIS WAS FOUND ──────────────────────────────────────────────────────
-- Deleting one workspace's 100,000 test runs did not finish in five minutes.
-- The cause is not the delete: it is the referential integrity check that
-- follows it.
--
-- Postgres does NOT index the referencing side of a foreign key automatically.
-- When a row in `agent_runs` is deleted, every child table with an FK to it must
-- be searched for rows that pointed at it — and where that column has no index,
-- the search is a sequential scan. Once per deleted row.
--
-- `agent_runs.continued_to_run_id` is the worst of them, because the child table
-- IS `agent_runs`: deleting N runs from a table of M scans M rows N times. At
-- N=100,000 and M=300,000 that is thirty billion row visits for a delete the
-- planner reports as trivial.
--
-- ── WHY THIS IS NOT ONLY A TEST PROBLEM ─────────────────────────────────────
-- The same scan runs behind retention pruning, workspace deletion, and any
-- cascade from a workflow being removed. It is invisible until the table is
-- large, which is exactly when someone first tries to prune it.
--
-- Every index below is on a foreign key that had none. They are small — a single
-- uuid column each — and they only ever help: the same columns are what a
-- "everything belonging to this run" lookup filters on.
CREATE INDEX IF NOT EXISTS agent_runs_continued_to_idx
    ON agent_runs (continued_to_run_id) WHERE continued_to_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agent_memory_entries_run_idx
    ON agent_memory_entries (run_id);

CREATE INDEX IF NOT EXISTS workflow_timers_run_idx
    ON workflow_timers (run_id);

CREATE INDEX IF NOT EXISTS agent_decisions_run_idx
    ON agent_decisions (run_id);

CREATE INDEX IF NOT EXISTS run_continuations_old_run_idx
    ON run_continuations (old_run_id);

CREATE INDEX IF NOT EXISTS run_continuations_new_run_idx
    ON run_continuations (new_run_id);
