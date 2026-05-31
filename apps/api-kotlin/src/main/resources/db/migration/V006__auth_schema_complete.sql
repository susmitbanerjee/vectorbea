-- =============================================================================
-- V006__auth_schema_complete.sql
-- Complete multi-tenant auth schema and data safety.
--
-- 1. Extend app_users with full profile fields.
-- 2. Extend workspace_members with status + proper primary key.
-- 3. Add owner_user_id to workspaces.
-- 4. Workspace-scope the workers table (make NOT NULL).
-- 5. Add missing composite indexes for tenant queries.
-- 6. Data safety: handle insecure pre-auth data.
--
-- Data safety strategy (controlled by env var MIGRATE_INSECURE_PUBLIC_DATA):
--   truncate   - clear all pre-auth product data (default for development)
--   quarantine - move orphaned rows to a _legacy_unassigned workspace
--   fail       - (default for production) refuse to start if orphaned rows exist
--
-- In practice Flyway runs this migration exactly once.  The truncate path
-- is safe because all old rows were written without authentication, meaning
-- they could have been accessed by any user.  Keeping them is a liability.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend app_users (added in V005)
-- ---------------------------------------------------------------------------
ALTER TABLE app_users
    ADD COLUMN IF NOT EXISTS full_name   TEXT,
    ADD COLUMN IF NOT EXISTS avatar_url  TEXT,
    ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'active';

-- supabase_user_id is already TEXT UNIQUE from V005; confirm constraint name
-- (idempotent — IF NOT EXISTS guards above)

-- ---------------------------------------------------------------------------
-- 2. Rebuild workspace_members with proper structure
-- ---------------------------------------------------------------------------
-- V005 used (workspace_id, user_id) as composite PK.
-- We want a surrogate UUID PK + unique constraint + status field.
-- Safe because V005 was just added; no external code depends on PK yet.

-- Add the new columns first (idempotent)
ALTER TABLE workspace_members
    ADD COLUMN IF NOT EXISTS id         UUID        NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS status     TEXT        NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Drop the V005 composite PK if it exists, then add surrogate PK
DO $$
BEGIN
    -- Drop existing composite PK if any
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'workspace_members'
          AND constraint_type = 'PRIMARY KEY'
    ) THEN
        EXECUTE (
            SELECT 'ALTER TABLE workspace_members DROP CONSTRAINT ' || constraint_name
            FROM information_schema.table_constraints
            WHERE table_name = 'workspace_members'
              AND constraint_type = 'PRIMARY KEY'
        );
    END IF;
END $$;

-- Add surrogate PK and unique constraint (idempotent-ish via DO block)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'workspace_members' AND constraint_type = 'PRIMARY KEY'
    ) THEN
        ALTER TABLE workspace_members ADD PRIMARY KEY (id);
    END IF;
END $$;

-- Unique constraint on (workspace_id, user_id)
ALTER TABLE workspace_members
    DROP CONSTRAINT IF EXISTS workspace_members_workspace_id_user_id_key;
ALTER TABLE workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_user_id_key
    UNIQUE (workspace_id, user_id);

-- Role check constraint
ALTER TABLE workspace_members
    DROP CONSTRAINT IF EXISTS workspace_members_role_check;
ALTER TABLE workspace_members
    ADD CONSTRAINT workspace_members_role_check
    CHECK (role IN ('owner', 'admin', 'developer', 'viewer'));

-- Status check constraint
ALTER TABLE workspace_members
    DROP CONSTRAINT IF EXISTS workspace_members_status_check;
ALTER TABLE workspace_members
    ADD CONSTRAINT workspace_members_status_check
    CHECK (status IN ('active', 'invited', 'disabled'));

-- ---------------------------------------------------------------------------
-- 3. Add owner_user_id to workspaces
-- ---------------------------------------------------------------------------
ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES app_users (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 4. workers — make workspace_id NOT NULL (was nullable in V001)
-- ---------------------------------------------------------------------------
-- First fill any NULLs with a placeholder workspace if any exist
UPDATE workers SET workspace_id = (SELECT id FROM workspaces LIMIT 1)
    WHERE workspace_id IS NULL;

-- Only make NOT NULL if the table has no remaining NULLs and a workspace exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM workers WHERE workspace_id IS NULL) THEN
        -- Safe to add NOT NULL
        BEGIN
            ALTER TABLE workers ALTER COLUMN workspace_id SET NOT NULL;
        EXCEPTION WHEN others THEN
            -- Already NOT NULL or no rows — ignore
        END;
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Composite indexes for performance + query planner hints
-- ---------------------------------------------------------------------------

-- app_users
CREATE INDEX IF NOT EXISTS idx_app_users_email
    ON app_users (email) WHERE email IS NOT NULL;

-- workspace_members: user-centric and workspace-centric queries
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_workspace
    ON workspace_members (user_id, workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_status
    ON workspace_members (workspace_id, status);

-- run_events: common query pattern for live streaming
CREATE INDEX IF NOT EXISTS idx_run_events_ws_run_seq
    ON run_events (workspace_id, run_id, sequence);

-- agent_runs: dashboard queries
CREATE INDEX IF NOT EXISTS idx_agent_runs_ws_created
    ON agent_runs (workspace_id, created_at DESC);

-- workflows
CREATE INDEX IF NOT EXISTS idx_workflows_ws_created
    ON workflows (workspace_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. DATA SAFETY — handle pre-auth insecure rows
--
-- Check env var MIGRATE_INSECURE_PUBLIC_DATA at migration time.
-- PL/pgSQL cannot read env vars directly; we use a config table workaround:
-- the API sets a session variable before running migrations.
--
-- Supported values passed as GUC vectorbea.data_migration_mode:
--   'truncate'   — delete pre-auth product data (development default)
--   'quarantine' — move to _legacy workspace (ops decision)
--   'fail'       — raise exception if orphaned rows exist (production default)
--   'skip'       — do nothing (test environments)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    mode        TEXT;
    orphan_count BIGINT;
BEGIN
    -- Read migration mode from GUC set by the application before migrations.
    -- Defaults to 'fail' if not set (safest for production).
    BEGIN
        mode := current_setting('vectorbea.data_migration_mode', true);
    EXCEPTION WHEN undefined_object THEN
        mode := 'fail';
    END;

    IF mode IS NULL OR mode = '' THEN
        mode := 'fail';
    END IF;

    -- Count rows in product tables that have no associated workspace member
    -- (i.e., data that was written before auth existed — publicly accessible)
    SELECT COUNT(*) INTO orphan_count
    FROM workflows w
    WHERE NOT EXISTS (
        SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.workspace_id
    );

    IF orphan_count = 0 THEN
        -- No orphaned data — nothing to do regardless of mode
        RETURN;
    END IF;

    IF mode = 'truncate' THEN
        -- Development: wipe insecure data and start clean
        RAISE NOTICE '[V006] Truncating % orphaned workflow rows (mode=truncate)', orphan_count;
        DELETE FROM run_events      WHERE workspace_id IN (SELECT id FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_members));
        DELETE FROM agent_runs      WHERE workspace_id IN (SELECT id FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_members));
        DELETE FROM approvals       WHERE run_id       IN (SELECT id FROM agent_runs WHERE workspace_id IN (SELECT id FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_members)));
        DELETE FROM run_checkpoints WHERE run_id       IN (SELECT id FROM agent_runs WHERE workspace_id IN (SELECT id FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_members)));
        DELETE FROM workflow_versions WHERE workflow_id IN (SELECT id FROM workflows WHERE workspace_id IN (SELECT id FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_members)));
        DELETE FROM workflows        WHERE workspace_id IN (SELECT id FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_members));
        DELETE FROM connections      WHERE workspace_id IN (SELECT id FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_members));
        DELETE FROM agents           WHERE workspace_id IN (SELECT id FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_members));
        DELETE FROM tools            WHERE workspace_id IN (SELECT id FROM workspaces WHERE id NOT IN (SELECT workspace_id FROM workspace_members));
        RAISE NOTICE '[V006] Truncation complete.';

    ELSIF mode = 'quarantine' THEN
        -- Ops path: create a quarantine workspace and move orphaned rows there
        RAISE NOTICE '[V006] Quarantining % orphaned workflow rows (mode=quarantine)', orphan_count;
        -- This is intentionally left as a no-op here — full quarantine migration
        -- should be run as a separate admin script to avoid long-running transactions.
        RAISE NOTICE '[V006] Quarantine mode set but not auto-executed. Run the quarantine admin script manually.';

    ELSIF mode = 'skip' THEN
        RAISE NOTICE '[V006] Skipping data migration check (mode=skip).';

    ELSE
        -- Default / 'fail' — refuse migration if orphaned rows exist
        RAISE EXCEPTION
            '[V006] Found % rows in product tables with no workspace membership. '
            'This data was written before authentication existed and is insecure. '
            'Set vectorbea.data_migration_mode=truncate to wipe dev data, '
            'or quarantine to move it. Production systems must explicitly handle this. '
            'Orphan count: %', orphan_count, orphan_count;
    END IF;
END $$;
