-- What a tool gives back to a model, declared by the tool.
--
-- ── THE PROBLEM, MEASURED ───────────────────────────────────────────────────
-- An agent's observation today is `{statusCode, body, headers}` serialised whole
-- and cut at 2000 characters with `String.take`. Measured against representative
-- API responses (`ObservationSizeReport`):
--
--   * 6 of 8 representative results truncate;
--   * EVERY truncated one is unparseable JSON — the cut lands mid-structure, so
--     the model receives a syntax error rather than less information;
--   * a single 56-field CRM contact (1788 chars) does not fit;
--   * the ten fields an agent actually wants are 17% of that record;
--   * response headers are 365 chars, 18% of the entire budget, and no model has
--     ever needed `strict-transport-security`.
--
-- No tool declares an output schema today (0 of 40 rows), so there is nothing
-- server-side that knows which fields matter. This column is that knowledge.
--
-- ── WHY ON THE TOOL AND NOT IN A SEPARATE TABLE ─────────────────────────────
-- The contract is a property OF the tool and changes with it: a tool whose
-- endpoint moves to a new API version needs a new projection in the same edit.
-- A separate table would be a second thing to keep in step, and the failure mode
-- of that — a projection describing a response shape the tool no longer returns —
-- is silent and produces empty observations.
--
-- `tools` has no version table; `updated_at` is its version. The contract
-- therefore versions with the tool by construction, which is what §6 of the brief
-- asks for.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────
-- {
--   "version": 1,
--   "fields": [ {"path": "body.Id", "as": "id", "desc": "Record id"}, ... ],
--   "collection": {
--     "path": "body.records",          -- the array
--     "totalPath": "body.totalSize",   -- where the real count lives, if given
--     "sample": 5,                     -- how many to project
--     "moreHint": "Narrow with the `where` argument."
--   },
--   "errors": [ {"match": {"status": 403}, "kind": "auth", "retryable": false,
--                "fix": "Reconnect the CRM credential in Connections."} ],
--   "usage": "Use for looking up ONE contact by email. For a list, use crm.search."
-- }
--
-- JSONB and not columns: the shape is a contract between the tool author and the
-- model, it will grow, and every growth would otherwise be a migration.
ALTER TABLE tools
    ADD COLUMN IF NOT EXISTS result_contract_json JSONB;

COMMENT ON COLUMN tools.result_contract_json IS
    'What the model sees of this tool''s result: the projected fields, the '
    'collection summary, the error mapping and the usage guidance. NULL means no '
    'contract — the tool falls back to the whole response, capped, exactly as '
    'before. See ToolResultContract.';

-- Tools that have one. Used by the adoption metric, and by the operator asking
-- "which of my tools are still sending the model forty opaque fields".
CREATE INDEX IF NOT EXISTS tools_with_result_contract_idx
    ON tools (workspace_id) WHERE result_contract_json IS NOT NULL;

-- ── OBSERVABILITY OF THE THING ITSELF ───────────────────────────────────────
-- Whether the projection worked is a per-call fact, not a per-tool one: a
-- contract can be right for one response and wrong for the next, and the failure
-- is silent (an empty projection reads as an empty result). So the outcome is
-- recorded on the iteration that used it.
--
-- Nullable with no default: an iteration that ran before this migration, or one
-- whose tool has no contract, genuinely has nothing to say here — and 'false'
-- would claim the projection was attempted and failed.
ALTER TABLE agent_iterations
    ADD COLUMN IF NOT EXISTS observation_projected BOOLEAN,
    ADD COLUMN IF NOT EXISTS observation_truncated BOOLEAN,
    ADD COLUMN IF NOT EXISTS observation_chars INTEGER;

COMMENT ON COLUMN agent_iterations.observation_projected IS
    'True when a result contract projected this observation. NULL means no '
    'contract applied (or the row predates contracts) — distinct from false, '
    'which would mean a contract was tried and produced nothing.';
COMMENT ON COLUMN agent_iterations.observation_truncated IS
    'True when the observation was still cut by MAX_TOOL_PAYLOAD_CHARS after any '
    'projection. On a contracted tool this should be rare; it is the acceptance '
    'criterion, and it is measured here rather than inferred from payload text.';

-- The adoption and effectiveness view.
--
-- A view rather than a note in a runbook, for the same reason the archive one is:
-- "did the contracts help" is asked weeks later by someone who will not
-- reconstruct the predicate.
CREATE OR REPLACE VIEW agent_observation_sizes AS
    SELECT i.workspace_id,
           i.selected_tool_id,
           t.name                                    AS tool_name,
           (t.result_contract_json IS NOT NULL)      AS tool_has_contract,
           count(*)                                  AS iterations,
           count(*) FILTER (WHERE i.observation_truncated)  AS truncated,
           round(100.0 * count(*) FILTER (WHERE i.observation_truncated)
                 / NULLIF(count(*), 0), 1)           AS truncated_pct,
           percentile_disc(0.5) WITHIN GROUP (ORDER BY i.observation_chars)
                                                     AS median_observation_chars
      FROM agent_iterations i
      LEFT JOIN tools t ON t.id = i.selected_tool_id
     WHERE i.action_type = 'CALL_TOOL'
     GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW agent_observation_sizes IS
    'Observation size and truncation rate per tool, split by whether the tool '
    'declares a result contract. The before/after for the contract work.';
