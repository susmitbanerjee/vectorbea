-- =============================================================================
-- V011__backfill_run_token_costs.sql
--
-- Backfill token_count and estimated_cost on agent_runs from run_events.
--
-- Before the worker fix, LlmNodeExecutor never stored estimated_cost in
-- run_events — so run_events.estimated_cost is NULL for all historical LLM
-- calls. Instead we sum token_count from run_events and estimate cost at
-- $2.00 per million tokens as a reasonable cross-model default.
--
-- Going forward the worker stores per-call cost in run_events and
-- updateRunCompleted() sums them into agent_runs on completion.
--
-- Safe to run multiple times (WHERE token_count IS NULL OR token_count = 0).
-- =============================================================================

UPDATE agent_runs ar
SET
    token_count    = ev.total_tokens,
    -- Estimate cost: $2/M tokens is a reasonable cross-model default.
    -- New runs will have accurate costs from the fixed updateRunCompleted().
    estimated_cost = ROUND((ev.total_tokens / 1000000.0 * 2.0)::numeric, 6),
    updated_at     = now()
FROM (
    SELECT
        run_id,
        COALESCE(SUM(token_count), 0) AS total_tokens
    FROM run_events
    WHERE token_count IS NOT NULL
    GROUP BY run_id
) ev
WHERE ar.id = ev.run_id
  AND ev.total_tokens > 0
  AND ar.status IN ('succeeded', 'failed', 'cancelled', 'timed_out')
  AND (ar.token_count IS NULL OR ar.token_count = 0);
