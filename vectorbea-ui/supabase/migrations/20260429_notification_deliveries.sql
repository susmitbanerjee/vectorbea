-- ─── notification_deliveries ─────────────────────────────────────────────────
-- Audit log for every notification attempt.
-- Used for debugging (why didn't I get an email?) and idempotency.
CREATE TABLE IF NOT EXISTS vectorbea.notification_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL,
  event_type          text NOT NULL,
  event_id            text,                 -- e.g. evaluation run id, alert event id
  recipient_user_id   uuid,
  recipient_email     text NOT NULL,
  channel             text NOT NULL DEFAULT 'email', -- 'email' | 'slack'
  status              text NOT NULL DEFAULT 'pending', -- 'sent' | 'skipped' | 'failed' | 'pending'
  skip_reason         text,                 -- why skipped: email_channel_disabled, severity_below_threshold, etc.
  provider_message_id text,                 -- id returned by Resend / SendGrid
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

-- Idempotency: prevent duplicate sends for the same event → recipient → channel
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_idempotency
  ON vectorbea.notification_deliveries(event_type, event_id, recipient_email, channel)
  WHERE status = 'sent' AND event_id IS NOT NULL;

-- Look up deliveries for a workspace quickly
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_workspace
  ON vectorbea.notification_deliveries(workspace_id, created_at DESC);

-- Grant service_role access
GRANT ALL ON vectorbea.notification_deliveries TO service_role;
