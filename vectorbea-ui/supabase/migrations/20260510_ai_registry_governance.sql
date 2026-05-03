-- ============================================================
-- VectorBea AI Registry Governance — 2026-05-10
-- ============================================================
-- Changes
--   ai_capabilities      add data_sensitivity, extend status check
--   capability_versions  extend status check (add 'approved')
--   policy_packs         add required_evidence + approval_requirements jsonb
--   ai_system_required_evidence  new table
--   capability_policy_pack_assignments  add status column
-- ============================================================

-- ─── ai_capabilities: add data_sensitivity ───────────────────────────────────

ALTER TABLE vectorbea.ai_capabilities
  ADD COLUMN IF NOT EXISTS data_sensitivity text
    NOT NULL DEFAULT 'internal'
    CHECK (data_sensitivity IN ('public','internal','confidential','restricted','regulated'));

-- Extend status to include governance lifecycle values
-- Postgres can't DROP and re-add a CHECK without recreating it, so we use a
-- trigger-less workaround: add a new CHECK alongside the old one.
ALTER TABLE vectorbea.ai_capabilities
  DROP CONSTRAINT IF EXISTS ai_capabilities_status_check;

ALTER TABLE vectorbea.ai_capabilities
  ADD CONSTRAINT ai_capabilities_status_check
    CHECK (status IN ('draft','active','blocked','under_review','archived'));

-- Migrate existing 'active' rows that were created before governance lifecycle
-- (no action needed — 'active' is still valid)

-- ─── capability_versions: extend status ──────────────────────────────────────

ALTER TABLE vectorbea.capability_versions
  DROP CONSTRAINT IF EXISTS capability_versions_status_check;

ALTER TABLE vectorbea.capability_versions
  ADD CONSTRAINT capability_versions_status_check
    CHECK (status IN ('draft','candidate','approved','active','blocked','deprecated'));

-- ─── policy_packs: governance metadata columns ───────────────────────────────

ALTER TABLE vectorbea.policy_packs
  ADD COLUMN IF NOT EXISTS required_evidence  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approval_requirements jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Extend sector check to include software_support (was just 'software')
ALTER TABLE vectorbea.policy_packs
  DROP CONSTRAINT IF EXISTS policy_packs_sector_check;

ALTER TABLE vectorbea.policy_packs
  ADD CONSTRAINT policy_packs_sector_check
    CHECK (sector IN (
      'retail','bfsi','healthcare','pharma','software','software_support',
      'travel','insurance','general'
    ));

-- ─── capability_policy_pack_assignments: add status ──────────────────────────

ALTER TABLE vectorbea.capability_policy_pack_assignments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled'));

-- ─── ai_system_required_evidence ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vectorbea.ai_system_required_evidence (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  ai_system_id     uuid        NOT NULL REFERENCES vectorbea.ai_capabilities(id) ON DELETE CASCADE,
  policy_pack_id   uuid        REFERENCES vectorbea.policy_packs(id) ON DELETE SET NULL,
  evidence_type    text        NOT NULL
                   CHECK (evidence_type IN (
                     'prompt_check','deterministic_check','behavioral_check',
                     'rag_grounding_check','mcp_tool_policy_check',
                     'workflow_regression','provider_comparison',
                     'human_approval','privacy_check','security_check'
                   )),
  label            text        NOT NULL,
  description      text,
  required         boolean     NOT NULL DEFAULT true,
  blocking         boolean     NOT NULL DEFAULT true,
  threshold        numeric,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_system_required_evidence_system
  ON vectorbea.ai_system_required_evidence (ai_system_id);
CREATE INDEX IF NOT EXISTS idx_ai_system_required_evidence_workspace
  ON vectorbea.ai_system_required_evidence (workspace_id, ai_system_id);

ALTER TABLE vectorbea.ai_system_required_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_ai_system_required_evidence"
  ON vectorbea.ai_system_required_evidence
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON vectorbea.ai_system_required_evidence TO service_role;

-- ─── Update policy pack seeds with required_evidence ─────────────────────────

-- General AI Safety Pack
UPDATE vectorbea.policy_packs
SET
  required_evidence = '[
    {"evidenceType":"behavioral_check","label":"Behavioral safety check","required":true,"blocking":true},
    {"evidenceType":"privacy_check","label":"PII / data exposure check","required":true,"blocking":true},
    {"evidenceType":"human_approval","label":"Human approval for high-risk deployment","required":false,"blocking":false}
  ]'::jsonb,
  approval_requirements = '{"requiresApproval":true,"approvalThreshold":"high_risk","approvers":["admin"]}'::jsonb
WHERE workspace_id IS NULL AND system_pack = true AND name = 'General AI Safety Pack';

-- Retail Refund Policy Pack
UPDATE vectorbea.policy_packs
SET
  required_evidence = '[
    {"evidenceType":"deterministic_check","label":"Refund decision boundary check","required":true,"blocking":true},
    {"evidenceType":"behavioral_check","label":"Customer tone and escalation check","required":true,"blocking":false},
    {"evidenceType":"human_approval","label":"Approval for policy threshold changes","required":true,"blocking":true}
  ]'::jsonb,
  approval_requirements = '{"requiresApproval":true,"approvalThreshold":"all","approvers":["admin","editor"]}'::jsonb
WHERE workspace_id IS NULL AND system_pack = true AND name ILIKE '%Retail%';

-- BFSI Policy Pack
UPDATE vectorbea.policy_packs
SET
  required_evidence = '[
    {"evidenceType":"privacy_check","label":"PII / financial data redaction check","required":true,"blocking":true},
    {"evidenceType":"deterministic_check","label":"Transaction limit boundary check","required":true,"blocking":true},
    {"evidenceType":"behavioral_check","label":"Regulatory language compliance check","required":true,"blocking":true},
    {"evidenceType":"human_approval","label":"Compliance officer sign-off","required":true,"blocking":true}
  ]'::jsonb,
  approval_requirements = '{"requiresApproval":true,"approvalThreshold":"all","approvers":["admin"]}'::jsonb
WHERE workspace_id IS NULL AND system_pack = true AND name ILIKE '%BFSI%';

-- Healthcare Policy Pack
UPDATE vectorbea.policy_packs
SET
  required_evidence = '[
    {"evidenceType":"privacy_check","label":"PHI / HIPAA data check","required":true,"blocking":true},
    {"evidenceType":"behavioral_check","label":"Clinical safety language check","required":true,"blocking":true},
    {"evidenceType":"human_approval","label":"Clinical reviewer approval","required":true,"blocking":true},
    {"evidenceType":"security_check","label":"Data residency verification","required":true,"blocking":false}
  ]'::jsonb,
  approval_requirements = '{"requiresApproval":true,"approvalThreshold":"all","approvers":["admin"]}'::jsonb
WHERE workspace_id IS NULL AND system_pack = true AND name ILIKE '%Healthcare%';

-- Pharma Policy Pack
UPDATE vectorbea.policy_packs
SET
  required_evidence = '[
    {"evidenceType":"behavioral_check","label":"Drug claims accuracy check","required":true,"blocking":true},
    {"evidenceType":"privacy_check","label":"Patient data protection check","required":true,"blocking":true},
    {"evidenceType":"human_approval","label":"Medical / regulatory approval","required":true,"blocking":true}
  ]'::jsonb,
  approval_requirements = '{"requiresApproval":true,"approvalThreshold":"all","approvers":["admin"]}'::jsonb
WHERE workspace_id IS NULL AND system_pack = true AND name ILIKE '%Pharma%';

-- Software Support Policy Pack
UPDATE vectorbea.policy_packs
SET
  required_evidence = '[
    {"evidenceType":"deterministic_check","label":"Escalation path correctness check","required":true,"blocking":true},
    {"evidenceType":"behavioral_check","label":"Support tone and accuracy check","required":true,"blocking":false},
    {"evidenceType":"workflow_regression","label":"Support workflow regression suite","required":false,"blocking":false}
  ]'::jsonb,
  approval_requirements = '{"requiresApproval":false,"approvalThreshold":"high_risk","approvers":["admin"]}'::jsonb
WHERE workspace_id IS NULL AND system_pack = true AND name ILIKE '%Software%';

-- Travel Policy Pack
UPDATE vectorbea.policy_packs
SET
  required_evidence = '[
    {"evidenceType":"deterministic_check","label":"Booking rule boundary check","required":true,"blocking":true},
    {"evidenceType":"behavioral_check","label":"Policy communication accuracy","required":true,"blocking":false},
    {"evidenceType":"provider_comparison","label":"Provider cost / quality comparison","required":false,"blocking":false}
  ]'::jsonb,
  approval_requirements = '{"requiresApproval":false,"approvalThreshold":"high_risk","approvers":["admin"]}'::jsonb
WHERE workspace_id IS NULL AND system_pack = true AND name ILIKE '%Travel%';
