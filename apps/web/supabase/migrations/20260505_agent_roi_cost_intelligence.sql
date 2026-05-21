-- ============================================================
-- VectorBea Phase 3
-- Agent ROI and Cost Intelligence
-- 2026-05-05
-- ============================================================

ALTER TABLE vectorbea.workflow_traces
  ADD COLUMN IF NOT EXISTS model_cost numeric(10,6),
  ADD COLUMN IF NOT EXISTS tool_cost numeric(10,6),
  ADD COLUMN IF NOT EXISTS judge_cost numeric(10,6),
  ADD COLUMN IF NOT EXISTS retry_cost numeric(10,6),
  ADD COLUMN IF NOT EXISTS outcome_status text
    CHECK (outcome_status IN ('success','failed','human_handoff','blocked','cancelled','timeout','partial_success')),
  ADD COLUMN IF NOT EXISTS outcome_reason text,
  ADD COLUMN IF NOT EXISTS final_business_outcome text;

CREATE INDEX IF NOT EXISTS idx_workflow_traces_outcome_status
  ON vectorbea.workflow_traces (workspace_id, outcome_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_traces_provider_model
  ON vectorbea.workflow_traces (workspace_id, provider, model, created_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.provider_pricing_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  input_token_price_per_million numeric(12,6) NOT NULL DEFAULT 0,
  output_token_price_per_million numeric(12,6) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_pricing_configs_lookup
  ON vectorbea.provider_pricing_configs (workspace_id, provider, model, effective_from DESC);

CREATE TABLE IF NOT EXISTS vectorbea.automation_roi_settings (
  workspace_id uuid PRIMARY KEY REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  average_manual_resolution_minutes numeric(8,2) NOT NULL DEFAULT 15,
  average_agent_operator_hourly_cost numeric(10,2) NOT NULL DEFAULT 20,
  currency text NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vectorbea.model_routing_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  capability_id uuid REFERENCES vectorbea.ai_capabilities(id) ON DELETE CASCADE,
  recommendation_type text NOT NULL
    CHECK (recommendation_type IN (
      'use_cheaper_model_for_low_risk',
      'escalate_high_risk_to_stronger_model',
      'reduce_retries',
      'add_tool_validation',
      'add_deterministic_rule',
      'change_provider',
      'add_human_handoff_earlier'
    )),
  summary text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  estimated_savings numeric(12,2),
  confidence numeric(4,3),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','accepted','dismissed','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_routing_recommendations_workspace
  ON vectorbea.model_routing_recommendations (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.roi_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_roi_reports_workspace
  ON vectorbea.roi_reports (workspace_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'provider_pricing_configs_updated_at') THEN
    CREATE TRIGGER provider_pricing_configs_updated_at
      BEFORE UPDATE ON vectorbea.provider_pricing_configs
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'automation_roi_settings_updated_at') THEN
    CREATE TRIGGER automation_roi_settings_updated_at
      BEFORE UPDATE ON vectorbea.automation_roi_settings
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
END $$;

ALTER TABLE vectorbea.provider_pricing_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.automation_roi_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.model_routing_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.roi_reports ENABLE ROW LEVEL SECURITY;

GRANT ALL ON vectorbea.provider_pricing_configs TO service_role;
GRANT ALL ON vectorbea.automation_roi_settings TO service_role;
GRANT ALL ON vectorbea.model_routing_recommendations TO service_role;
GRANT ALL ON vectorbea.roi_reports TO service_role;
