-- =============================================================================
-- V012__fix_zero_estimated_cost.sql
--
-- Fix runs where token_count is populated but estimated_cost is still 0.0.
--
-- Timeline of what happened:
--   1. Commit b527b01: updateRunCompleted() was fixed to SUM from run_events.
--      It set token_count correctly but estimated_cost = 0.0 because
--      run_events.estimated_cost was still NULL at that time (the worker
--      did not store cost per event yet).
--
--   2. V011 backfill: only updated rows WHERE token_count IS NULL OR = 0,
--      so it missed all rows already populated by step 1.
--
--   3. Commits 6232f9c + 1648d09: fixed LlmNodeExecutor and AgentBrainRunner
--      to store estimatedCost in run_events going forward.
--
-- This migration patches the gap: rows with token_count > 0 but
-- estimated_cost = 0.0, using a cost estimate of $2/M tokens as a
-- reasonable cross-model default. New runs will have accurate costs
-- from the worker fix.
-- =============================================================================

UPDATE agent_runs
SET
    estimated_cost = ROUND((token_count / 1000000.0 * 2.0)::numeric, 8),
    updated_at     = now()
WHERE token_count > 0
  AND (estimated_cost IS NULL OR estimated_cost = 0.0)
  AND status IN ('succeeded', 'failed', 'cancelled', 'timed_out', 'recovering');
