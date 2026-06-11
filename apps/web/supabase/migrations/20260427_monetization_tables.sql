-- ============================================================
-- VectorBea Monetization Tables Migration
-- 2026-04-27
-- ============================================================

-- ─── workspace_invitations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vectorbea.workspace_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email           text NOT NULL,
  role            text NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  invited_by      uuid NOT NULL,
  inviter_name    text,
  token_hash      text NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace
  ON vectorbea.workspace_invitations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_token
  ON vectorbea.workspace_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email
  ON vectorbea.workspace_invitations(email);

-- ─── workspace_notification_prefs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vectorbea.workspace_notification_prefs (
  workspace_id    uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  email_enabled   boolean NOT NULL DEFAULT true,
  slack_enabled   boolean NOT NULL DEFAULT false,
  events          jsonb NOT NULL DEFAULT '{
    "alerts": true,
    "regressions": true,
    "evaluations": true,
    "rollout": true,
    "quota": true
  }'::jsonb,
  slack_events    jsonb NOT NULL DEFAULT '{
    "alerts": true,
    "regressions": true,
    "evaluations": false,
    "rollout": true,
    "quota": false
  }'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── user_notification_prefs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vectorbea.user_notification_prefs (
  user_id         uuid PRIMARY KEY,
  events          jsonb NOT NULL DEFAULT '{
    "evaluation_failures": true,
    "review_requests": true,
    "invitations": true,
    "rollout_decisions": true
  }'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── workspace_integrations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vectorbea.workspace_integrations (
  workspace_id                uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  slack_webhook_encrypted     text,
  slack_enabled               boolean NOT NULL DEFAULT false,
  slack_events                jsonb NOT NULL DEFAULT '{
    "alerts": true,
    "regressions": true,
    "evaluations": false,
    "rollout": true,
    "quota": false
  }'::jsonb,
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- ─── prompt_release_policies (if not already created) ───────────────────────
-- This was added in an earlier migration; guard with IF NOT EXISTS
CREATE TABLE IF NOT EXISTS vectorbea.prompt_release_policies (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid NOT NULL,
  prompt_id                 uuid NOT NULL,
  min_score                 numeric(5,4),
  require_no_critical       boolean NOT NULL DEFAULT true,
  require_no_regressions    boolean NOT NULL DEFAULT false,
  max_regressions           int,
  block_on_any_failure      boolean NOT NULL DEFAULT false,
  block_on_safety_failure   boolean NOT NULL DEFAULT true,
  block_on_latency_spike    boolean NOT NULL DEFAULT false,
  block_on_json_failure     boolean NOT NULL DEFAULT false,
  created_by                uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_release_policies_workspace
  ON vectorbea.prompt_release_policies(workspace_id);

-- Grant access to the service role
GRANT ALL ON ALL TABLES IN SCHEMA vectorbea TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vectorbea TO service_role;
