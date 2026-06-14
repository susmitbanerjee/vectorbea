-- ---------------------------------------------------------------------------
-- builtin_email_usage
-- Per-workspace monthly quota for platform-subsidised built-in email sends.
-- The built-in sender is a convenience that uses platform credentials, so it is
-- capped (default 15 / month) and enforced atomically at send time to be
-- abuse-proof. Workspaces that need more should connect their own email provider.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS builtin_email_usage (
    workspace_id  UUID        NOT NULL,
    period_month  TEXT        NOT NULL,            -- 'YYYY-MM' (UTC)
    sent_count    INTEGER     NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, period_month)
);
