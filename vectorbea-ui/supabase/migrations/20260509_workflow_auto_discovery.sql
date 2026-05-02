-- ============================================================
-- VectorBea Workflow Auto Discovery and Workflow Space
-- 2026-05-09
-- ============================================================

CREATE TABLE IF NOT EXISTS vectorbea.discovery_sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'detecting'
                CHECK (status IN ('detecting','ready_for_review','confirmed','ignored')),
  source        text        NOT NULL DEFAULT 'sdk'
                CHECK (source IN ('sdk','sidecar','opentelemetry','direct_api','proxy')),
  environment   text,
  started_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovery_sessions_workspace_idx
  ON vectorbea.discovery_sessions (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.discovered_capabilities (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  session_id           uuid        NOT NULL REFERENCES vectorbea.discovery_sessions(id) ON DELETE CASCADE,
  suggested_name       text        NOT NULL,
  suggested_type       text        NOT NULL DEFAULT 'agent_workflow',
  service_name         text,
  environment          text,
  confidence           numeric(5,2) NOT NULL DEFAULT 0.50,
  matched_capability_id uuid       REFERENCES vectorbea.ai_capabilities(id) ON DELETE SET NULL,
  status               text        NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','matched','confirmed','ignored','merged')),
  metadata             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovered_capabilities_workspace_idx
  ON vectorbea.discovered_capabilities (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS discovered_capabilities_session_idx
  ON vectorbea.discovered_capabilities (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS discovered_capabilities_name_env_idx
  ON vectorbea.discovered_capabilities (workspace_id, suggested_name, environment);

CREATE TABLE IF NOT EXISTS vectorbea.discovered_tools (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  session_id        uuid        NOT NULL REFERENCES vectorbea.discovery_sessions(id) ON DELETE CASCADE,
  tool_name         text        NOT NULL,
  mcp_server_name   text,
  argument_schema   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  result_schema     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  seen_count        integer     NOT NULL DEFAULT 1,
  status            text        NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','confirmed','ignored','merged')),
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovered_tools_workspace_idx
  ON vectorbea.discovered_tools (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS discovered_tools_session_idx
  ON vectorbea.discovered_tools (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS discovered_tools_lookup_idx
  ON vectorbea.discovered_tools (workspace_id, tool_name, mcp_server_name);

CREATE TABLE IF NOT EXISTS vectorbea.discovered_workflows (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  session_id          uuid        NOT NULL REFERENCES vectorbea.discovery_sessions(id) ON DELETE CASCADE,
  name                text        NOT NULL,
  capability_name     text,
  trace_id            uuid        REFERENCES vectorbea.workflow_traces(id) ON DELETE CASCADE,
  workflow_shape_hash text        NOT NULL,
  steps               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  edges               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  suggested_rules     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  latency_ms          integer,
  cost_estimate       numeric(10,6),
  status              text        NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','confirmed','ignored','merged')),
  source_badge        text        NOT NULL DEFAULT 'sdk'
                     CHECK (source_badge IN ('sdk','sidecar','opentelemetry','direct_api','proxy')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovered_workflows_workspace_idx
  ON vectorbea.discovered_workflows (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS discovered_workflows_session_idx
  ON vectorbea.discovered_workflows (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS discovered_workflows_shape_idx
  ON vectorbea.discovered_workflows (workspace_id, workflow_shape_hash);
CREATE INDEX IF NOT EXISTS discovered_workflows_trace_idx
  ON vectorbea.discovered_workflows (trace_id);

CREATE TABLE IF NOT EXISTS vectorbea.discovered_workflow_steps (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  discovered_workflow_id uuid       NOT NULL REFERENCES vectorbea.discovered_workflows(id) ON DELETE CASCADE,
  workflow_trace_step_id uuid       REFERENCES vectorbea.workflow_step_traces(id) ON DELETE SET NULL,
  node_id               text        NOT NULL,
  parent_node_id        text,
  step_index            integer     NOT NULL DEFAULT 0,
  node_type             text        NOT NULL,
  name                  text        NOT NULL,
  status                text        NOT NULL DEFAULT 'completed',
  provider              text,
  model                 text,
  tool_name             text,
  mcp_server_name       text,
  latency_ms            integer,
  cost_estimate         numeric(10,6),
  input_preview         text,
  output_preview        text,
  error                 text,
  metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovered_workflow_steps_workflow_idx
  ON vectorbea.discovered_workflow_steps (discovered_workflow_id, step_index ASC);

CREATE TABLE IF NOT EXISTS vectorbea.tool_registry (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id               uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  name                       text        NOT NULL,
  description                text,
  mcp_server_name            text,
  argument_schema            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  result_schema              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at              timestamptz,
  last_seen_at               timestamptz,
  created_from_discovery_id  uuid        REFERENCES vectorbea.discovered_tools(id) ON DELETE SET NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tool_registry_workspace_idx
  ON vectorbea.tool_registry (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_registry_lookup_idx
  ON vectorbea.tool_registry (workspace_id, name, mcp_server_name);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tool_registry_workspace_name_uq'
  ) THEN
    ALTER TABLE vectorbea.tool_registry
      ADD CONSTRAINT tool_registry_workspace_name_uq
      UNIQUE (workspace_id, name, mcp_server_name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'discovery_sessions_updated_at') THEN
    CREATE TRIGGER discovery_sessions_updated_at
      BEFORE UPDATE ON vectorbea.discovery_sessions
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'discovered_capabilities_updated_at') THEN
    CREATE TRIGGER discovered_capabilities_updated_at
      BEFORE UPDATE ON vectorbea.discovered_capabilities
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'discovered_tools_updated_at') THEN
    CREATE TRIGGER discovered_tools_updated_at
      BEFORE UPDATE ON vectorbea.discovered_tools
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'discovered_workflows_updated_at') THEN
    CREATE TRIGGER discovered_workflows_updated_at
      BEFORE UPDATE ON vectorbea.discovered_workflows
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tool_registry_updated_at') THEN
    CREATE TRIGGER tool_registry_updated_at
      BEFORE UPDATE ON vectorbea.tool_registry
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
END $$;

ALTER TABLE vectorbea.discovery_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.discovered_capabilities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.discovered_tools            ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.discovered_workflows        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.discovered_workflow_steps   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.tool_registry               ENABLE ROW LEVEL SECURITY;

GRANT ALL ON vectorbea.discovery_sessions        TO service_role;
GRANT ALL ON vectorbea.discovered_capabilities   TO service_role;
GRANT ALL ON vectorbea.discovered_tools          TO service_role;
GRANT ALL ON vectorbea.discovered_workflows      TO service_role;
GRANT ALL ON vectorbea.discovered_workflow_steps TO service_role;
GRANT ALL ON vectorbea.tool_registry             TO service_role;
