-- Ensure connections table exists in vectorbea schema.
-- If an earlier migration created public.connections, move it into vectorbea.

CREATE SCHEMA IF NOT EXISTS vectorbea;

DO $$
BEGIN
  IF to_regclass('public.connections') IS NOT NULL
     AND to_regclass('vectorbea.connections') IS NULL THEN
    EXECUTE 'ALTER TABLE public.connections SET SCHEMA vectorbea';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS vectorbea.connections (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid          NOT NULL,
  name                 text          NOT NULL,
  slug                 text          NOT NULL,
  type                 text          NOT NULL,
  provider             text          NOT NULL,
  environment          text          NOT NULL DEFAULT 'development',
  status               text          NOT NULL DEFAULT 'not_tested',
  auth_type            text          NOT NULL DEFAULT 'none',
  secret_ref           text,
  secret_masked        text,
  config               jsonb         NOT NULL DEFAULT '{}',
  network_policy       jsonb         NOT NULL DEFAULT '{"requireWhitelist":false,"privateRunnerRequired":false,"networkStatus":"unknown"}',
  last_tested_at       timestamptz,
  last_test_status     text,
  last_test_latency_ms integer,
  last_test_error      text,
  used_by_agent_ids    text[]        NOT NULL DEFAULT '{}',
  used_by_tool_ids     text[]        NOT NULL DEFAULT '{}',
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT connections_workspace_slug_unique UNIQUE (workspace_id, slug),
  CONSTRAINT connections_type_check CHECK (type IN (
    'llm_provider','database','http_api','saas','mcp_server','vector_store','object_storage'
  )),
  CONSTRAINT connections_status_check CHECK (status IN (
    'connected','not_tested','failed','needs_whitelist','missing_secret','disabled'
  )),
  CONSTRAINT connections_environment_check CHECK (environment IN (
    'development','staging','production'
  ))
);

CREATE INDEX IF NOT EXISTS idx_connections_workspace_id
  ON vectorbea.connections (workspace_id);

CREATE INDEX IF NOT EXISTS idx_connections_workspace_type
  ON vectorbea.connections (workspace_id, type);

CREATE INDEX IF NOT EXISTS idx_connections_workspace_status
  ON vectorbea.connections (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_connections_updated_at
  ON vectorbea.connections (updated_at DESC);

CREATE OR REPLACE FUNCTION vectorbea.update_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_connections_updated_at ON vectorbea.connections;
CREATE TRIGGER trg_connections_updated_at
  BEFORE UPDATE ON vectorbea.connections
  FOR EACH ROW EXECUTE FUNCTION vectorbea.update_connections_updated_at();
