-- =============================================================================
-- V038__workspace_invitations.sql
-- The one settings table that had no home in Postgres.
--
-- `lib/server/invitations.ts` wrote `vectorbea.workspace_invitations` in a
-- Supabase project that no environment provisions, so inviting a teammate has
-- never worked in any deployment. Everything else Settings needs already exists
-- here: workspaces, workspace_members, app_users, workspace_usage_policies,
-- workspace_beta_controls, usage_limit_requests, audit_log.
--
-- Membership removal deliberately does NOT need a column: V006 already allows
-- status 'disabled', and seat counting filters on 'active'. Disabling frees the
-- seat and keeps the record, which is what an audit asks for.
-- =============================================================================

CREATE TABLE IF NOT EXISTS workspace_invitations (
    id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    email        TEXT        NOT NULL,
    role         TEXT        NOT NULL DEFAULT 'viewer',
    invited_by   UUID        REFERENCES app_users (id) ON DELETE SET NULL,
    inviter_name TEXT        NOT NULL DEFAULT '',
    -- Hashed, never stored raw. The link in the email is the only copy of the
    -- token; a leaked database row must not be a working invitation.
    token_hash   TEXT        NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    accepted_at  TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Matches workspace_members_role_check. 'owner' is deliberately absent:
    -- ownership is transferred, not invited.
    CONSTRAINT workspace_invitations_role_check
        CHECK (role IN ('admin', 'developer', 'viewer'))
);

-- Accepting an invitation is a lookup by token hash and nothing else.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_token_hash_idx
    ON workspace_invitations (token_hash);

-- The Members screen: this workspace's invitations, newest first.
CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_idx
    ON workspace_invitations (workspace_id, created_at DESC);

-- At most one live invitation per address per workspace. Enforced here rather
-- than by a SELECT-then-INSERT in the application, which races two admins
-- inviting the same person into two valid tokens.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_pending_idx
    ON workspace_invitations (workspace_id, lower(email))
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE workspace_invitations IS
    'Pending and historical workspace invitations. Tokens are stored hashed; '
    'the partial unique index permits exactly one live invitation per address.';
