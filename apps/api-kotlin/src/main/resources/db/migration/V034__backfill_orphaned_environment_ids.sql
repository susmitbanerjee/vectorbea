-- =============================================================================
-- V034__backfill_orphaned_environment_ids.sql
--
-- Data-repair migration, not a schema change.
--
-- workflows.environment_id, agent_runs.environment_id and
-- connections.environment_id were never given a foreign key to
-- environments(id) (see V001), so nothing has ever stopped a row from
-- referencing an environment that doesn't exist for its workspace. In
-- practice every workflow/run/connection row in production points at an
-- environment_id absent from `environments` — the web app's `toEnvironment()`
-- treats any value that isn't a real 'production' | 'staging' | 'development'
-- row as "unknown", which is why Control, Runs, and Incidents all render
-- "unknown" for every row regardless of what actually happened.
--
-- This backfill, per workspace:
--   1. Picks a canonical environment: the workspace's sole existing
--      environment if it has exactly one, otherwise (zero, or more than one
--      and therefore ambiguous) creates/reuses a 'production' environment.
--   2. Repoints every workflows/agent_runs/connections row whose
--      environment_id has no matching environments row onto the canonical
--      one.
--
-- This cannot recover which real environment each orphaned row belonged to
-- — that information was never recorded — so it makes a best-effort, visible
-- choice (the workspace's one real environment, or 'production' as the safe
-- default) rather than leaving rows permanently unclassifiable. Idempotent:
-- rerunning finds no remaining orphans and changes nothing.
-- =============================================================================

DO $$
DECLARE
  ws RECORD;
  canonical_env_id UUID;
  env_count INT;
BEGIN
  FOR ws IN SELECT id FROM workspaces LOOP
    SELECT COUNT(*) INTO env_count FROM environments WHERE workspace_id = ws.id;

    IF env_count = 1 THEN
      SELECT id INTO canonical_env_id FROM environments WHERE workspace_id = ws.id LIMIT 1;
    ELSE
      -- Zero environments, or more than one with no way to tell which is
      -- authoritative — reuse a 'production' row if one already exists,
      -- otherwise create it.
      SELECT id INTO canonical_env_id
        FROM environments WHERE workspace_id = ws.id AND type = 'production' LIMIT 1;

      IF canonical_env_id IS NULL THEN
        INSERT INTO environments (workspace_id, name, slug, type)
        VALUES (ws.id, 'Production', 'production', 'production')
        ON CONFLICT (workspace_id, slug) DO UPDATE SET slug = environments.slug
        RETURNING id INTO canonical_env_id;
      END IF;
    END IF;

    UPDATE workflows w
      SET environment_id = canonical_env_id
      WHERE w.workspace_id = ws.id
        AND NOT EXISTS (SELECT 1 FROM environments e WHERE e.id = w.environment_id);

    UPDATE agent_runs r
      SET environment_id = canonical_env_id
      WHERE r.workspace_id = ws.id
        AND NOT EXISTS (SELECT 1 FROM environments e WHERE e.id = r.environment_id);

    UPDATE connections c
      SET environment_id = canonical_env_id
      WHERE c.workspace_id = ws.id
        AND NOT EXISTS (SELECT 1 FROM environments e WHERE e.id = c.environment_id);
  END LOOP;
END
$$;
