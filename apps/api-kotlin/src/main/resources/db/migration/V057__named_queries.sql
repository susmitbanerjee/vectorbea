-- Named queries: the SQL an agent may run, authored by a human and stored.
--
-- ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
-- A database tool holds a `config_json.sqlTemplate`, and `ToolNodeExecutor`
-- decides whether it is a read or a write by upper-casing its first whitespace-
-- delimited token:
--
--     val firstWord = sql.split(Regex("\\s+"), limit = 2).firstOrNull()?.uppercase()
--     if (firstWord == "SELECT") dbRead else dbWrite
--
-- Three problems, and they are not equally severe.
--
-- 1. CLASSIFICATION BY PREFIX. A leading comment, a CTE, or any form the string
--    match did not anticipate lands on the wrong path. The read executor
--    re-checks for SELECT, so a write cannot trivially reach it — but the
--    classification is a keyword match on a path that reaches a production
--    database, and `SELECT write_something()` is a write whose first token is
--    SELECT. The fix is not a better parser. It is to stop parsing: the tool
--    author DECLARES read or write, and the runtime obeys the declaration.
--
-- 2. PARAMETERS ARE INTERPOLATED, NOT BOUND. `{{ expr }}` templates are replaced
--    with SQL literals — `"'" + value.replace("'", "''") + "'"` — which is string
--    concatenation with one escape rule, on values that reach it from an agent's
--    tool input. Named queries bind.
--
-- 3. RESULTS ARE BOUNDED BY ROWS, NOT BYTES. `stmt.maxRows` caps at 10 000, and
--    `resultSetToList` materialises every one of them into a `List<Map>` before
--    anything sees a size. Ten thousand rows of a wide table is tens of megabytes
--    of worker heap. Every named query declares its own limit, and it is small.
--
-- ── AND THE ONE THIS DOES NOT CLAIM TO FIX ──────────────────────────────────
-- The model has no schema affordance. It does not get one here either — it gets
-- something better for the same problem: it no longer needs to know the schema,
-- because it is choosing a described query rather than composing SQL against
-- tables it is guessing at.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────
-- {
--   "version": 1,
--   "queries": [{
--     "id": "orders_by_customer",
--     "description": "Orders for one customer, newest first.",
--     "parameters": [
--       {"name": "customerId", "type": "string", "required": true,
--        "description": "The customer's id, as returned by crm.search."}
--     ],
--     "sql": "SELECT id, status, total_cents FROM orders WHERE customer_id = :customerId",
--     "access": "read",
--     "maxRows": 50,
--     "timeoutMs": 5000
--   }]
-- }
--
-- `access` is DECLARED. Nothing reads the SQL to decide.
ALTER TABLE tools
    ADD COLUMN IF NOT EXISTS named_queries_json JSONB;

COMMENT ON COLUMN tools.named_queries_json IS
    'The catalogue of SQL a database tool may run: id, description, typed and '
    'bound parameters, human-authored SQL, a DECLARED read/write access level, '
    'and a mandatory row limit and timeout. An agent selects a query id and '
    'supplies parameters; it never composes SQL. See NamedQuery.';

-- ── THE MIGRATION FLAG ──────────────────────────────────────────────────────
--
-- Default FALSE, and that is safe for existing tools because of when it is read:
-- free-form is refused only when a caller supplies SQL that is not in the
-- catalogue. A tool with a stored `sqlTemplate` and no named queries keeps
-- running it, because the SQL is the tool author's, not the agent's — that is
-- exactly the property named queries are introducing, and such a tool already
-- has it.
--
-- What the flag gates is an AGENT-SUPPLIED statement, which is the case that must
-- not be reachable by default.
--
-- NOT NULL DEFAULT false rather than nullable: a null would be a third state
-- ("nobody has decided") on a security boundary, and every read of it would need
-- to pick a meaning. The default IS the decision.
ALTER TABLE tools
    ADD COLUMN IF NOT EXISTS allow_freeform_sql BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tools.allow_freeform_sql IS
    'Whether a CALLER may supply SQL to this tool rather than choosing a named '
    'query. Default false. A stored sqlTemplate is unaffected — that SQL is the '
    'tool author''s. This gates statements arriving from an agent or a node config.';

CREATE INDEX IF NOT EXISTS tools_freeform_sql_idx
    ON tools (workspace_id) WHERE allow_freeform_sql;

-- ── THE MIGRATION SURVEY, AS A VIEW ─────────────────────────────────────────
--
-- Item 7 asks which existing tools use free-form SQL and what they actually run,
-- because that set is the initial catalogue. It cannot be answered from this
-- repository — the only `tools` rows here are HTTP test fixtures — so the
-- question is shipped as a view against real data rather than as a number
-- invented for it.
CREATE OR REPLACE VIEW database_tools_sql_survey AS
    SELECT t.workspace_id,
           t.id                                            AS tool_id,
           t.name,
           t.type,
           t.requires_approval,
           t.allow_freeform_sql,
           (t.named_queries_json IS NOT NULL)              AS has_catalogue,
           jsonb_array_length(COALESCE(t.named_queries_json -> 'queries', '[]'::jsonb))
                                                           AS named_query_count,
           (t.config_json ? 'sqlTemplate')                 AS has_sql_template,
           -- The first token, which is what the runtime classifies on today.
           upper(split_part(btrim(COALESCE(t.config_json ->> 'sqlTemplate', '')), ' ', 1))
                                                           AS classified_as,
           -- Whether that classification is one the string match can get wrong.
           (btrim(COALESCE(t.config_json ->> 'sqlTemplate', '')) ~* '^\s*(--|/\*|WITH)')
                                                           AS prefix_is_ambiguous,
           left(COALESCE(t.config_json ->> 'sqlTemplate', ''), 400) AS sql_head
      FROM tools t
     WHERE t.type IN ('database', 'database_read', 'database_write')
        OR t.config_json ? 'sqlTemplate';

COMMENT ON VIEW database_tools_sql_survey IS
    'Every tool that carries SQL: how it is classified today, whether its prefix '
    'is one the keyword match can misread, and whether it has a named-query '
    'catalogue yet. The migration worklist.';
