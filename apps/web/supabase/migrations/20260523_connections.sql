-- ─────────────────────────────────────────────────────────────────────────────
-- Vectorbee Connections table
-- Stores named, configured access to external systems (LLM providers,
-- databases, HTTP APIs, SaaS tools, MCP servers, vector stores, object storage).
-- Secrets are NEVER stored here — only masked display values and secret ref names.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS connections (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid          NOT NULL,

  -- Identity
  name                 text          NOT NULL,
  slug                 text          NOT NULL,
  type                 text          NOT NULL,      -- llm_provider | database | http_api | saas | mcp_server | vector_store | object_storage
  provider             text          NOT NULL,      -- e.g. openai, postgresql, slack
  environment          text          NOT NULL DEFAULT 'development',  -- development | staging | production
  status               text          NOT NULL DEFAULT 'not_tested',   -- connected | not_tested | failed | needs_whitelist | missing_secret | disabled

  -- Auth (NO raw secrets stored here)
  auth_type            text          NOT NULL DEFAULT 'none',
  secret_ref           text,         -- reference name in secrets backend (e.g. "my-openai-key")
  secret_masked        text,         -- masked display value only (e.g. "sk-...k9Xz")

  -- Type-specific config (no secrets — endpoints, models, options only)
  config               jsonb         NOT NULL DEFAULT '{}',

  -- Network access policy
  network_policy       jsonb         NOT NULL DEFAULT '{"requireWhitelist":false,"privateRunnerRequired":false,"networkStatus":"unknown"}',

  -- Last test results
  last_tested_at       timestamptz,
  last_test_status     text,         -- ok | failed | skipped
  last_test_latency_ms integer,
  last_test_error      text,

  -- Usage tracking (denormalized for quick display)
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

-- Foreign key to workspaces (soft — workspace_id may be a UUID from Supabase Auth)
-- Omitted intentionally: workspaces table lives in the vectorbea schema and
-- enforcing FK across schemas requires explicit schema-qualification which
-- varies by deployment. Workspace isolation is enforced at the API layer via
-- assertWorkspaceMember.

-- Indexes
CREATE INDEX IF NOT EXISTS idx_connections_workspace_id
  ON connections (workspace_id);

CREATE INDEX IF NOT EXISTS idx_connections_workspace_type
  ON connections (workspace_id, type);

CREATE INDEX IF NOT EXISTS idx_connections_workspace_status
  ON connections (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_connections_updated_at
  ON connections (updated_at DESC);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_connections_updated_at ON connections;
CREATE TRIGGER trg_connections_updated_at
  BEFORE UPDATE ON connections
  FOR EACH ROW EXECUTE FUNCTION update_connections_updated_at();
