CREATE SCHEMA IF NOT EXISTS vectorbea;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS vectorbea.workspace_notification_prefs (
  workspace_id uuid PRIMARY KEY REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT true,
  slack_enabled boolean NOT NULL DEFAULT false,
  events jsonb NOT NULL DEFAULT '{}'::jsonb,
  slack_events jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vectorbea.user_notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  events jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vectorbea.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'slack')),
  event_type text NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_deliveries_workspace_idx
  ON vectorbea.notification_deliveries(workspace_id, created_at DESC);

