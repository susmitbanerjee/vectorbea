-- =============================================================================
-- V005__auth_users.sql
-- Multi-tenant authentication tables.
--
-- app_users:          maps Supabase auth user IDs to internal application users.
-- workspace_members:  authorization table — which users can access which workspaces,
--                     and with what role.
--
-- Security model:
--   - All Kotlin API routes verify the Supabase JWT and derive user identity from
--     the JWT `sub` claim.  X-Workspace-Id headers are verified against this table.
--   - No client-supplied user ID or role is trusted.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- app_users
-- One row per Supabase auth user who has ever logged in.
-- supabase_user_id is the JWT `sub` claim (UUID string).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_users (
    id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    supabase_user_id TEXT        NOT NULL,
    email            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_supabase_user_id
    ON app_users (supabase_user_id);

-- ---------------------------------------------------------------------------
-- workspace_members
-- Authorization join: user ↔ workspace, with role.
-- Roles: 'owner' | 'admin' | 'member' | 'viewer'
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id  UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id       UUID        NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
    role          TEXT        NOT NULL DEFAULT 'member',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id
    ON workspace_members (user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id
    ON workspace_members (workspace_id);
