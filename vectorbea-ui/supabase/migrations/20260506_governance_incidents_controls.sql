-- ============================================================
-- VectorBea Phase 4
-- Production Governance, Incident Loop, and Enterprise Controls
-- 2026-05-06
-- ============================================================

CREATE TABLE IF NOT EXISTS vectorbea.ai_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  capability_id uuid REFERENCES vectorbea.ai_capabilities(id) ON DELETE SET NULL,
  capability_version_id uuid REFERENCES vectorbea.capability_versions(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','fix_in_progress','verification_pending','resolved','dismissed')),
  source_type text NOT NULL CHECK (source_type IN ('alert','trace','workflow_regression','safety_gate','manual','notification')),
  source_id text,
  failure_cluster_id uuid,
  owner_user_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ai_incidents_workspace_created
  ON vectorbea.ai_incidents (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_incidents_workspace_status
  ON vectorbea.ai_incidents (workspace_id, status, severity, updated_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.failure_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  capability_id uuid REFERENCES vectorbea.ai_capabilities(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  cluster_type text NOT NULL CHECK (cluster_type IN (
    'policy_violation','wrong_tool_selected','required_tool_skipped','invalid_arguments','unsafe_action',
    'hallucinated_response','missing_context','wrong_context','format_violation','provider_timeout',
    'agent_loop','high_cost','high_latency','human_handoff_spike','unknown'
  )),
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  grouping_key text NOT NULL,
  affected_runs_count integer NOT NULL DEFAULT 0,
  affected_traces_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','monitoring','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_failure_clusters_grouping
  ON vectorbea.failure_clusters (workspace_id, grouping_key);
CREATE INDEX IF NOT EXISTS idx_failure_clusters_workspace_status
  ON vectorbea.failure_clusters (workspace_id, status, severity, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.failure_cluster_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  cluster_id uuid NOT NULL REFERENCES vectorbea.failure_clusters(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('trace','workflow_regression_case','reliability_rule_result','evaluation_run','alert_event')),
  source_id text NOT NULL,
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_failure_cluster_items_unique
  ON vectorbea.failure_cluster_items (cluster_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS vectorbea.incident_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES vectorbea.ai_incidents(id) ON DELETE CASCADE,
  actor_user_id uuid,
  activity_type text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_activity_incident
  ON vectorbea.incident_activity (incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.incident_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES vectorbea.ai_incidents(id) ON DELETE CASCADE,
  regression_run_id uuid NOT NULL REFERENCES vectorbea.workflow_regression_runs(id) ON DELETE CASCADE,
  capability_version_id uuid REFERENCES vectorbea.capability_versions(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('passed','failed','needs_review')),
  summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_verifications_incident
  ON vectorbea.incident_verifications (incident_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  actor_user_id uuid,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  entity_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_workspace_created
  ON vectorbea.audit_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_workspace_type
  ON vectorbea.audit_events (workspace_id, event_type, entity_type, created_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  capability_id uuid REFERENCES vectorbea.ai_capabilities(id) ON DELETE SET NULL,
  capability_version_id uuid REFERENCES vectorbea.capability_versions(id) ON DELETE SET NULL,
  request_type text NOT NULL CHECK (request_type IN ('rollout_approval','incident_resolution','policy_override','high_risk_action')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by uuid NOT NULL,
  required_approvals integer NOT NULL DEFAULT 1,
  approved_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_approval_requests_workspace_status
  ON vectorbea.approval_requests (workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  approval_request_id uuid NOT NULL REFERENCES vectorbea.approval_requests(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_decisions_unique
  ON vectorbea.approval_decisions (approval_request_id, reviewer_user_id);

CREATE TABLE IF NOT EXISTS vectorbea.policy_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  sector text NOT NULL CHECK (sector IN ('retail','bfsi','healthcare','pharma','software','travel','insurance','general')),
  version text NOT NULL DEFAULT '1.0.0',
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  system_pack boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_packs_workspace
  ON vectorbea.policy_packs (workspace_id, sector, created_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.capability_policy_pack_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  capability_id uuid NOT NULL REFERENCES vectorbea.ai_capabilities(id) ON DELETE CASCADE,
  policy_pack_id uuid NOT NULL REFERENCES vectorbea.policy_packs(id) ON DELETE CASCADE,
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now(),
  enabled boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_capability_policy_pack_assignments_unique
  ON vectorbea.capability_policy_pack_assignments (capability_id, policy_pack_id);

CREATE TABLE IF NOT EXISTS vectorbea.redaction_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('regex','field_name','built_in')),
  pattern text NOT NULL,
  replacement text NOT NULL DEFAULT '[REDACTED]',
  enabled boolean NOT NULL DEFAULT true,
  scope text NOT NULL CHECK (scope IN ('traces','tool_arguments','tool_results','final_response','all')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redaction_rules_workspace
  ON vectorbea.redaction_rules (workspace_id, enabled, scope, created_at DESC);

CREATE TABLE IF NOT EXISTS vectorbea.privacy_settings (
  workspace_id uuid PRIMARY KEY REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  enable_pii_redaction boolean NOT NULL DEFAULT true,
  store_raw_inputs boolean NOT NULL DEFAULT true,
  store_raw_outputs boolean NOT NULL DEFAULT true,
  store_tool_arguments boolean NOT NULL DEFAULT true,
  store_tool_results boolean NOT NULL DEFAULT true,
  retention_days integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_incidents_failure_cluster_id_fkey'
  ) THEN
    ALTER TABLE vectorbea.ai_incidents
      ADD CONSTRAINT ai_incidents_failure_cluster_id_fkey
      FOREIGN KEY (failure_cluster_id)
      REFERENCES vectorbea.failure_clusters(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ai_incidents_updated_at') THEN
    CREATE TRIGGER ai_incidents_updated_at
      BEFORE UPDATE ON vectorbea.ai_incidents
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'failure_clusters_updated_at') THEN
    CREATE TRIGGER failure_clusters_updated_at
      BEFORE UPDATE ON vectorbea.failure_clusters
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'approval_requests_updated_at') THEN
    CREATE TRIGGER approval_requests_updated_at
      BEFORE UPDATE ON vectorbea.approval_requests
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'redaction_rules_updated_at') THEN
    CREATE TRIGGER redaction_rules_updated_at
      BEFORE UPDATE ON vectorbea.redaction_rules
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'privacy_settings_updated_at') THEN
    CREATE TRIGGER privacy_settings_updated_at
      BEFORE UPDATE ON vectorbea.privacy_settings
      FOR EACH ROW EXECUTE FUNCTION vectorbea.touch_updated_at();
  END IF;
END $$;

ALTER TABLE vectorbea.ai_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.failure_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.failure_cluster_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.incident_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.incident_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.policy_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.capability_policy_pack_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.redaction_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectorbea.privacy_settings ENABLE ROW LEVEL SECURITY;

GRANT ALL ON vectorbea.ai_incidents TO service_role;
GRANT ALL ON vectorbea.failure_clusters TO service_role;
GRANT ALL ON vectorbea.failure_cluster_items TO service_role;
GRANT ALL ON vectorbea.incident_activity TO service_role;
GRANT ALL ON vectorbea.incident_verifications TO service_role;
GRANT ALL ON vectorbea.audit_events TO service_role;
GRANT ALL ON vectorbea.approval_requests TO service_role;
GRANT ALL ON vectorbea.approval_decisions TO service_role;
GRANT ALL ON vectorbea.policy_packs TO service_role;
GRANT ALL ON vectorbea.capability_policy_pack_assignments TO service_role;
GRANT ALL ON vectorbea.redaction_rules TO service_role;
GRANT ALL ON vectorbea.privacy_settings TO service_role;

INSERT INTO vectorbea.policy_packs (workspace_id, name, description, sector, version, rules, enabled, system_pack)
SELECT NULL, seed.name, seed.description, seed.sector, '1.0.0', seed.rules::jsonb, true, true
FROM (
  VALUES
    (
      'Retail Refund Policy Pack',
      'Deterministic controls for refund, discount, and inventory workflows.',
      'retail',
      '[
        {"name":"Refund requires eligibility check first","ruleType":"tool_sequence","severity":"critical","config":{"required_before":"checkRefundEligibility","target_tool":"createRefund"}},
        {"name":"Refund forbidden when eligibility is false","ruleType":"tool_result_condition","severity":"critical","config":{"tool":"checkRefundEligibility","result_field":"eligible","operator":"==","value":"true"}},
        {"name":"Discount above threshold requires approval","ruleType":"human_handoff_required","severity":"high","config":{"trigger":"high_discount"}},
        {"name":"Inventory check required before delivery promise","ruleType":"tool_required","severity":"high","config":{"required_tool":"checkInventory"}}
      ]'
    ),
    (
      'BFSI Policy Pack',
      'PII, risk, and approval defaults for financial workflows.',
      'bfsi',
      '[
        {"name":"PII must be masked","ruleType":"pii_detection","severity":"critical","config":{"built_in":"email"}},
        {"name":"High risk transaction requires risk check","ruleType":"tool_required","severity":"critical","config":{"required_tool":"risk_check"}},
        {"name":"Loan decision requires eligibility evidence","ruleType":"tool_required","severity":"high","config":{"required_tool":"checkEligibility"}},
        {"name":"Human review required for high value decisions","ruleType":"human_handoff_required","severity":"critical","config":{"trigger":"high_value_decision"}}
      ]'
    ),
    (
      'Healthcare Policy Pack',
      'Escalation and source controls for healthcare assistants.',
      'healthcare',
      '[
        {"name":"Diagnosis final action forbidden","ruleType":"final_action_condition","severity":"critical","config":{"forbidden_actions":["diagnosis_provided"]}},
        {"name":"Emergency symptoms require escalation","ruleType":"human_handoff_required","severity":"critical","config":{"trigger":"emergency_symptoms"}},
        {"name":"Medical advice must cite approved source","ruleType":"tool_required","severity":"high","config":{"required_tool":"approved_medical_source"}},
        {"name":"Medication change advice forbidden","ruleType":"output_not_contains","severity":"critical","config":{"text":"change your medication"}}
      ]'
    ),
    (
      'Pharma Policy Pack',
      'Approved-label and escalation rules for pharma workflows.',
      'pharma',
      '[
        {"name":"Off label claim forbidden","ruleType":"output_not_contains","severity":"critical","config":{"text":"off label"}},
        {"name":"Approved label citation required","ruleType":"tool_required","severity":"high","config":{"required_tool":"approved_label_lookup"}},
        {"name":"Adverse event mention requires escalation","ruleType":"human_handoff_required","severity":"critical","config":{"trigger":"adverse_event"}}
      ]'
    ),
    (
      'Software Support Policy Pack',
      'Safety defaults for support agents and production actions.',
      'software',
      '[
        {"name":"Secrets exposure forbidden","ruleType":"output_not_contains","severity":"critical","config":{"text":"api_key"}},
        {"name":"Destructive command requires warning","ruleType":"tool_sequence","severity":"high","config":{"required_before":"warnUser","target_tool":"runDestructiveCommand"}},
        {"name":"Production action requires approval","ruleType":"human_handoff_required","severity":"critical","config":{"trigger":"production_action"}},
        {"name":"Credential request forbidden","ruleType":"output_not_contains","severity":"critical","config":{"text":"password"}}
      ]'
    ),
    (
      'Travel Policy Pack',
      'Availability, policy, and confirmation controls for travel workflows.',
      'travel',
      '[
        {"name":"Booking change requires availability check","ruleType":"tool_required","severity":"high","config":{"required_tool":"checkAvailability"}},
        {"name":"Refund or cancellation requires policy check","ruleType":"tool_required","severity":"critical","config":{"required_tool":"checkRefundPolicy"}},
        {"name":"Payment action requires confirmation","ruleType":"human_handoff_required","severity":"high","config":{"trigger":"payment_action"}},
        {"name":"Customer notification requires verified contact","ruleType":"tool_required","severity":"medium","config":{"required_tool":"verifyContact"}}
      ]'
    )
) AS seed(name, description, sector, rules)
WHERE NOT EXISTS (
  SELECT 1
  FROM vectorbea.policy_packs existing
  WHERE existing.workspace_id IS NULL
    AND existing.system_pack = true
    AND existing.name = seed.name
);
