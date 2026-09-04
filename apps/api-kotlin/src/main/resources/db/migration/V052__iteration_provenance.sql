-- Two facts about an iteration that the runtime knew and never wrote down.
--
-- ── WHY THESE ARE COLUMNS AND NOT DERIVED AT READ TIME ───────────────────────
-- Both distinguish "the agent did this" from "the runtime did this on the
-- agent's behalf", and the inspector cannot tell them apart from anything
-- currently stored.
--
--   action_repaired    An unparseable model response is repaired into a THINK so
--                      the loop can continue (AgentBrainRunner.parseAction). The
--                      stored row is then indistinguishable from an iteration
--                      where the model genuinely chose to think — so the trace
--                      shows deliberation where there was a parse failure, which
--                      is the opposite of what happened and sends the reader
--                      looking at the prompt instead of at the response format.
--
--   tool_result_cached The step guard replays a previous identical call rather
--                      than executing it, emitting STEP_SKIPPED. The observation
--                      that reaches the model is the OLD result. A reader shown
--                      that result with no marker believes the tool ran now and
--                      returned this — and will happily conclude an external
--                      system is returning stale data.
--
-- Nullable with no default, deliberately: NULL means "this row predates the
-- column", which is different from false. The API and the worker deploy
-- independently, so an older worker writing rows that leave these null must not
-- make the reader believe every call executed fresh.
ALTER TABLE agent_iterations
    ADD COLUMN IF NOT EXISTS action_repaired    BOOLEAN,
    ADD COLUMN IF NOT EXISTS tool_result_cached BOOLEAN;

COMMENT ON COLUMN agent_iterations.action_repaired IS
    'True when the model response could not be parsed and was repaired into a THINK. '
    'NULL means the row predates this column, which is not the same as false.';

COMMENT ON COLUMN agent_iterations.tool_result_cached IS
    'True when the step guard replayed a previous identical tool call instead of '
    'executing it. NULL means the row predates this column.';
