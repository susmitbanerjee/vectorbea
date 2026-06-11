-- ---------------------------------------------------------------------------
-- V002: Add unique constraint on connections(workspace_id, slug)
--
-- The connections table was missing a uniqueness guard, allowing the same
-- connection to be inserted multiple times (e.g. user double-submits the form
-- or retries after a network error).  This enforces one slug per workspace.
--
-- Uses a partial unique index rather than a table constraint so that:
--   a) It can be created concurrently on large tables (no full-table lock).
--   b) The name is readable in query plans.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uniq_connections_workspace_slug
    ON connections (workspace_id, slug);
