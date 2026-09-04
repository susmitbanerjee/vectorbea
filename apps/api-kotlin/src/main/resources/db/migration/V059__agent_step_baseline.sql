-- ---------------------------------------------------------------------------
-- V059 — the index the "typical for this agent" baseline reads
--
-- The Activity view answers "14 steps — is that normal?" and the only honest
-- answer comes from what this same agent usually takes on runs that SUCCEEDED.
-- That query groups `agent_iterations` by (run_id, step_id) for one agent_id
-- across recent successful runs.
--
-- `agent_iterations` is indexed on (run_id, step_id, iteration_number) and on
-- (workspace_id, run_id) — both keyed by the run. Neither helps a lookup that
-- starts from an AGENT, so the baseline would sequentially scan every iteration
-- ever written on every open of the Debug tab. This index is the difference
-- between a debugger that opens and one people stop using.
--
-- Deliberately reads from agent_iterations rather than agent_activations:
-- `AGENT_ACTIVATIONS_ENABLED` defaults to off and is set in no environment file
-- in this repository, so the single-agent path writes no activation row at all.
-- A baseline that needs activations would be permanently empty in exactly the
-- deployment we have.
--
-- CONCURRENTLY is deliberately NOT used: Flyway runs migrations inside a
-- transaction and CREATE INDEX CONCURRENTLY cannot run in one. The table is
-- small enough today that the brief lock is cheaper than the machinery of an
-- out-of-band build.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_agent_iterations_agent_recent
    ON agent_iterations (workspace_id, agent_id, started_at DESC);

COMMENT ON INDEX idx_agent_iterations_agent_recent IS
    'Serves the Activity view''s per-agent step-count baseline: recent '
    'iterations for one agent in one workspace, newest first.';
