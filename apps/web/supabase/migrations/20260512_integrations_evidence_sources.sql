-- ─────────────────────────────────────────────────────────────────────────────
-- VectorBea: Integrations as Evidence Sources
-- Migration: 20260512_integrations_evidence_sources
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Integration connections ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.integration_connections (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  integration_type    text        NOT NULL CHECK (integration_type IN (
    'sidecar','opentelemetry','sdk','direct_api','llm_provider',
    'mcp_server','rag_pipeline','classification_system','extraction_system',
    'skill_runtime','ci_cd','manual_upload','langgraph','custom_webhook'
  )),
  name                text        NOT NULL,
  description         text,
  status              text        NOT NULL DEFAULT 'not_configured' CHECK (status IN (
    'not_configured','configured','connected','disabled','error'
  )),
  health_status       text        NOT NULL DEFAULT 'unknown' CHECK (health_status IN (
    'healthy','degraded','failing','unknown'
  )),
  last_seen_at        timestamptz,
  last_success_at     timestamptz,
  last_error_at       timestamptz,
  last_error_message  text,
  config              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  disabled_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_integration_connections_workspace
  ON vectorbea.integration_connections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_integration_connections_type
  ON vectorbea.integration_connections(integration_type);
CREATE INDEX IF NOT EXISTS idx_integration_connections_status
  ON vectorbea.integration_connections(status);

-- ── 2. Evidence source events ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.evidence_source_events (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  integration_connection_id uuid        REFERENCES vectorbea.integration_connections(id) ON DELETE SET NULL,
  source_type               text        NOT NULL CHECK (source_type IN (
    'sidecar','opentelemetry','sdk','direct_api','llm_provider',
    'mcp_server','rag_pipeline','classification_system','extraction_system',
    'skill_runtime','ci_cd','manual_upload','langgraph','custom_webhook'
  )),
  source_id                 text,
  ai_system_id              uuid        REFERENCES vectorbea.ai_capabilities(id) ON DELETE SET NULL,
  ai_system_version_id      uuid        REFERENCES vectorbea.capability_versions(id) ON DELETE SET NULL,
  event_type                text        NOT NULL CHECK (event_type IN (
    'agent_run','llm_call','tool_call','mcp_tool_call','rag_retrieval',
    'rag_answer','classification_result','extraction_result','skill_execution',
    'prompt_execution','ci_evidence','manual_evidence','provider_usage',
    'policy_check_result','workflow_trace'
  )),
  status                    text        NOT NULL DEFAULT 'received' CHECK (status IN (
    'received','normalized','validated','failed','ignored'
  )),
  payload                   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_source_events_workspace
  ON vectorbea.evidence_source_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_evidence_source_events_ai_system
  ON vectorbea.evidence_source_events(ai_system_id);
CREATE INDEX IF NOT EXISTS idx_evidence_source_events_created
  ON vectorbea.evidence_source_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_source_events_source_type
  ON vectorbea.evidence_source_events(source_type);

-- ── 3. Discovered AI systems ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.discovered_ai_systems (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  suggested_name        text        NOT NULL,
  source_type           text        NOT NULL,
  service_name          text,
  provider              text,
  model                 text,
  environment           text,
  tools_detected        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  mcp_servers_detected  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  seen_count            integer     NOT NULL DEFAULT 1,
  status                text        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','linked','registered','ignored'
  )),
  linked_ai_system_id   uuid        REFERENCES vectorbea.ai_capabilities(id) ON DELETE SET NULL,
  metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovered_ai_systems_workspace
  ON vectorbea.discovered_ai_systems(workspace_id);
CREATE INDEX IF NOT EXISTS idx_discovered_ai_systems_status
  ON vectorbea.discovered_ai_systems(status);

-- ── 4. AI system aliases ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.ai_system_aliases (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  ai_system_id  uuid        NOT NULL REFERENCES vectorbea.ai_capabilities(id) ON DELETE CASCADE,
  alias         text        NOT NULL,
  source_type   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, alias)
);

CREATE INDEX IF NOT EXISTS idx_ai_system_aliases_workspace
  ON vectorbea.ai_system_aliases(workspace_id, alias);

-- ── 5. RLS (Row Level Security) ───────────────────────────────────────────────

ALTER TABLE vectorbea.integration_connections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.evidence_source_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.discovered_ai_systems      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.ai_system_aliases          ENABLE ROW LEVEL SECURITY;

-- Service role bypass (admin client always uses service role)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'integration_connections' AND policyname = 'service_role_all') THEN
    CREATE POLICY service_role_all ON vectorbea.integration_connections FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'evidence_source_events' AND policyname = 'service_role_all') THEN
    CREATE POLICY service_role_all ON vectorbea.evidence_source_events FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'discovered_ai_systems' AND policyname = 'service_role_all') THEN
    CREATE POLICY service_role_all ON vectorbea.discovered_ai_systems FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ai_system_aliases' AND policyname = 'service_role_all') THEN
    CREATE POLICY service_role_all ON vectorbea.ai_system_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
