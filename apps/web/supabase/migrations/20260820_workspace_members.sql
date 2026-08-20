-- ============================================================
-- VectorBea Workspace Members
-- 2026-08-20
--
-- Tracked migration for vectorbea.workspace_members — backs the
-- Members tab (app/api/workspaces/[id]/members/route.ts), sidebar
-- member counts, and account creation (lib/auth/neon-auth.ts
-- createUser, which INSERTs workspace_members(workspace_id, user_id,
-- role, status)). Never captured as a migration in this repo (see
-- 20260820_audit_logs.sql for the same class of gap). IF NOT EXISTS
-- makes this a no-op against environments where the table already
-- exists with this shape.
-- ============================================================

CREATE TABLE IF NOT EXISTS vectorbea.workspace_members (
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_user_id_idx
  ON vectorbea.workspace_members (user_id) WHERE status = 'active';
