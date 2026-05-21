-- Usage metering and quota alert tracking

CREATE TABLE IF NOT EXISTS vectorbea.workspace_usage_monthly (
  id                               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                     uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  month                            date NOT NULL,
  traces_count                     integer NOT NULL DEFAULT 0,
  replay_runs_count                integer NOT NULL DEFAULT 0,
  evaluation_executions_count      integer NOT NULL DEFAULT 0,
  provider_executions_count        integer NOT NULL DEFAULT 0,
  judge_executions_count           integer NOT NULL DEFAULT 0,
  scheduled_regression_runs_count  integer NOT NULL DEFAULT 0,
  provider_arena_runs_count        integer NOT NULL DEFAULT 0,
  notification_emails_count        integer NOT NULL DEFAULT 0,
  created_at                       timestamptz NOT NULL DEFAULT now(),
  updated_at                       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_usage_monthly_unique UNIQUE (workspace_id, month)
);

CREATE INDEX IF NOT EXISTS idx_workspace_usage_monthly_workspace_month
  ON vectorbea.workspace_usage_monthly (workspace_id, month DESC);

CREATE TABLE IF NOT EXISTS vectorbea.workspace_usage_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  month        date NOT NULL,
  event_type   text NOT NULL,
  quantity     integer NOT NULL DEFAULT 1,
  source_type  text NOT NULL,
  source_id    text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_usage_events_idempotent
  ON vectorbea.workspace_usage_events (workspace_id, month, event_type, source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_usage_events_workspace_month
  ON vectorbea.workspace_usage_events (workspace_id, month DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.workspace_usage_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  month        date NOT NULL,
  meter        text NOT NULL,
  threshold    integer NOT NULL,
  event_type   text NOT NULL,
  used         integer NOT NULL,
  limit_value  integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_usage_alerts_unique UNIQUE (workspace_id, month, meter, threshold)
);

CREATE INDEX IF NOT EXISTS idx_workspace_usage_alerts_workspace_month
  ON vectorbea.workspace_usage_alerts (workspace_id, month DESC, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'workspace_usage_monthly_updated_at') THEN
    CREATE TRIGGER workspace_usage_monthly_updated_at
      BEFORE UPDATE ON vectorbea.workspace_usage_monthly
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
END $$;

ALTER TABLE vectorbea.workspace_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.workspace_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.workspace_usage_alerts ENABLE ROW LEVEL SECURITY;

GRANT ALL ON vectorbea.workspace_usage_monthly TO service_role;
GRANT ALL ON vectorbea.workspace_usage_events TO service_role;
GRANT ALL ON vectorbea.workspace_usage_alerts TO service_role;
