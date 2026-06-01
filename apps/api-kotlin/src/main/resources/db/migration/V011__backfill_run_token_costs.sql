-- =============================================================================
-- V011__backfill_run_token_costs.sql
--
-- Backfill token_count and estimated_cost on agent_runs from run_events.
--
-- Before the worker fix in commit b527b01, updateRunCompleted() never wrote
-- token_count or estimated_cost to agent_runs. Every run completed before
-- that fix has NULL in those columns even though the per-LLM-call data is
-- stored correctly in run_events.
--
-- This migration aggregates from run_events and back-fills the parent
-- agent_runs row so the runs list and dashboard metrics show real values
-- for all historical runs.
--
-- Safe to run multiple times (UPDATE … WHERE token_count IS NULL).
-- =============================================================================

UPDATE agent_runs ar
SET
    token_count    = COALESCE(ev.total_tokens, 0),
    estimated_cost = COALESCE(ev.total_cost,   0.0),
    updated_at     = now()
FROM (
    SELECT
        run_id,
        SUM(token_count)     AS total_tokens,
        SUM(estimated_cost)  AS total_cost
    FROM run_events
    WHERE token_count IS NOT NULL
       OR estimated_cost IS NOT NULL
    GROUP BY run_id
) ev
WHERE ar.id = ev.run_id
  AND ar.status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
  AND (ar.token_count IS NULL OR ar.token_count = 0);
