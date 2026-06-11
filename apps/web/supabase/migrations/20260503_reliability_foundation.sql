-- ============================================================
-- VectorBea Reliability Foundation — Phase 1
-- 2026-05-03
-- ============================================================
-- Tables
--   ai_capabilities          workspace-scoped capability registry
--   capability_versions      versioned configs per capability
--   workflow_traces          top-level agent/skill/tool run traces
--   workflow_step_traces     per-step breakdown within a trace
--   reliability_rules        deterministic rules for a capability
--   reliability_rule_results results of running rules against traces
-- ============================================================

-- ─── ai_capabilities ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.ai_capabilities (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  name             text        NOT NULL,
  description      text,
  type             text        NOT NULL DEFAULT 'prompt'
                   CHECK (type IN (
                     'prompt','skill','agent_workflow','rag_workflow','mcp_workflow',
                     'content_generation','classification','extraction',
                     'customer_support','internal_automation'
                   )),
  business_domain  text        NOT NULL DEFAULT 'general'
                   CHECK (business_domain IN (
                     'customer_support','finance','claims','refunds','healthcare_triage',
                     'pharma_documentation','travel_booking','software_support',
                     'content_generation','internal_automation','sales','operations','general'
                   )),
  risk_level       text        NOT NULL DEFAULT 'medium'
                   CHECK (risk_level IN ('low','medium','high','critical')),
  owner_user_id    uuid,
  status           text        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','archived')),
  -- backward-compat: link to existing prompt if this capability wraps one
  prompt_id        uuid        REFERENCES vectorbea.prompts(id) ON DELETE SET NULL,
  created_by       uuid        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_capabilities_workspace
  ON vectorbea.ai_capabilities (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_capabilities_prompt
  ON vectorbea.ai_capabilities (prompt_id);
CREATE INDEX IF NOT EXISTS idx_ai_capabilities_status
  ON vectorbea.ai_capabilities (workspace_id, status);

-- ─── capability_versions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.capability_versions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  capability_id         uuid        NOT NULL REFERENCES vectorbea.ai_capabilities(id) ON DELETE CASCADE,
  version_number        text        NOT NULL,
  name                  text,
  status                text        NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','candidate','active','deprecated')),
  config                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- backward-compat links
  prompt_version_id     uuid        REFERENCES vectorbea.prompt_versions(id) ON DELETE SET NULL,
  skill_definition      jsonb,
  workflow_definition   jsonb,
  provider_config       jsonb,
  tool_policy_id        uuid,
  created_by            uuid        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  activated_at          timestamptz,
  deprecated_at         timestamptz,
  UNIQUE (capability_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_capability_versions_capability
  ON vectorbea.capability_versions (capability_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capability_versions_prompt_version
  ON vectorbea.capability_versions (prompt_version_id);
CREATE INDEX IF NOT EXISTS idx_capability_versions_status
  ON vectorbea.capability_versions (capability_id, status);

-- ─── workflow_traces ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.workflow_traces (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  capability_id          uuid        REFERENCES vectorbea.ai_capabilities(id) ON DELETE SET NULL,
  capability_version_id  uuid        REFERENCES vectorbea.capability_versions(id) ON DELETE SET NULL,
  -- backward-compat: existing prompt traces
  prompt_id              uuid        REFERENCES vectorbea.prompts(id) ON DELETE SET NULL,
  prompt_version_id      uuid        REFERENCES vectorbea.prompt_versions(id) ON DELETE SET NULL,
  agent_run_id           text,
  trace_id               text,
  provider               text,
  model                  text,
  user_input             text,
  final_response         text,
  final_action           text,
  status                 text        NOT NULL DEFAULT 'completed'
                         CHECK (status IN ('running','completed','failed','cancelled')),
  total_latency_ms       integer,
  total_cost_estimate    numeric(10,6),
  total_tokens_input     integer,
  total_tokens_output    integer,
  error_message          text,
  metadata               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_traces_workspace
  ON vectorbea.workflow_traces (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_traces_capability
  ON vectorbea.workflow_traces (capability_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_traces_agent_run
  ON vectorbea.workflow_traces (agent_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_traces_trace_id
  ON vectorbea.workflow_traces (trace_id);

-- ─── workflow_step_traces ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.workflow_step_traces (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  workflow_trace_id  uuid        NOT NULL REFERENCES vectorbea.workflow_traces(id) ON DELETE CASCADE,
  step_index         integer     NOT NULL DEFAULT 0,
  step_type          text        NOT NULL DEFAULT 'llm_call'
                     CHECK (step_type IN (
                       'llm_call','tool_call','mcp_tool_call','rag_retrieval',
                       'reranker','decision','human_handoff','final_response','system_event'
                     )),
  step_name          text        NOT NULL,
  provider           text,
  model              text,
  tool_name          text,
  mcp_server_name    text,
  input_payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  output_payload     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  tool_arguments     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  tool_result        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status             text        NOT NULL DEFAULT 'completed'
                     CHECK (status IN ('running','completed','failed','skipped')),
  latency_ms         integer,
  cost_estimate      numeric(10,6),
  tokens_input       integer,
  tokens_output      integer,
  error_message      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_step_traces_trace
  ON vectorbea.workflow_step_traces (workflow_trace_id, step_index ASC);
CREATE INDEX IF NOT EXISTS idx_workflow_step_traces_workspace
  ON vectorbea.workflow_step_traces (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_step_traces_tool
  ON vectorbea.workflow_step_traces (workspace_id, tool_name);

-- ─── reliability_rules ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.reliability_rules (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  capability_id          uuid        REFERENCES vectorbea.ai_capabilities(id) ON DELETE CASCADE,
  capability_version_id  uuid        REFERENCES vectorbea.capability_versions(id) ON DELETE SET NULL,
  name                   text        NOT NULL,
  description            text,
  rule_type              text        NOT NULL
                         CHECK (rule_type IN (
                           'tool_sequence','tool_required','tool_forbidden',
                           'argument_validation','schema_validation','regex_check',
                           'cost_threshold','latency_threshold','max_tool_calls',
                           'pii_detection','business_policy','human_handoff_required',
                           'output_contains','output_not_contains',
                           'tool_result_condition','final_action_condition'
                         )),
  severity               text        NOT NULL DEFAULT 'medium'
                         CHECK (severity IN ('low','medium','high','critical')),
  enabled                boolean     NOT NULL DEFAULT true,
  config                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by             uuid        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reliability_rules_workspace
  ON vectorbea.reliability_rules (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reliability_rules_capability
  ON vectorbea.reliability_rules (capability_id);

-- ─── reliability_rule_results ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.reliability_rule_results (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  rule_id             uuid        NOT NULL REFERENCES vectorbea.reliability_rules(id) ON DELETE CASCADE,
  workflow_trace_id   uuid        REFERENCES vectorbea.workflow_traces(id) ON DELETE CASCADE,
  evaluation_run_id   uuid        REFERENCES vectorbea.evaluation_runs(id) ON DELETE CASCADE,
  status              text        NOT NULL DEFAULT 'passed'
                      CHECK (status IN ('passed','failed','skipped','error')),
  passed              boolean     NOT NULL DEFAULT true,
  severity            text        NOT NULL DEFAULT 'medium',
  message             text        NOT NULL DEFAULT '',
  details             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reliability_rule_results_rule
  ON vectorbea.reliability_rule_results (rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reliability_rule_results_trace
  ON vectorbea.reliability_rule_results (workflow_trace_id);
CREATE INDEX IF NOT EXISTS idx_reliability_rule_results_workspace
  ON vectorbea.reliability_rule_results (workspace_id, created_at DESC);

-- ─── Triggers ────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ai_capabilities_updated_at') THEN
    CREATE TRIGGER ai_capabilities_updated_at
      BEFORE UPDATE ON vectorbea.ai_capabilities
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'capability_versions_updated_at') THEN
    CREATE TRIGGER capability_versions_updated_at
      BEFORE UPDATE ON vectorbea.capability_versions
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reliability_rules_updated_at') THEN
    CREATE TRIGGER reliability_rules_updated_at
      BEFORE UPDATE ON vectorbea.reliability_rules
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
END $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE vectorbea.ai_capabilities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.capability_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.workflow_traces          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.workflow_step_traces     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.reliability_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.reliability_rule_results ENABLE ROW LEVEL SECURITY;

-- ─── Grants ──────────────────────────────────────────────────────────────────

GRANT ALL ON vectorbea.ai_capabilities          TO service_role;
GRANT ALL ON vectorbea.capability_versions      TO service_role;
GRANT ALL ON vectorbea.workflow_traces          TO service_role;
GRANT ALL ON vectorbea.workflow_step_traces     TO service_role;
GRANT ALL ON vectorbea.reliability_rules        TO service_role;
GRANT ALL ON vectorbea.reliability_rule_results TO service_role;
