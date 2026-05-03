-- ============================================================
-- VectorBea Evidence Runs — 2026-05-11
-- ============================================================
-- New table: capability_evidence_runs
--   Stores evidence run records linked to AI system versions.
--   Supports all evidence types defined in EvidenceType.
-- ============================================================

CREATE TABLE IF NOT EXISTS vectorbea.capability_evidence_runs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid        NOT NULL REFERENCES vectorbea.workspaces(id) ON DELETE CASCADE,
  ai_system_id          uuid        NOT NULL REFERENCES vectorbea.ai_capabilities(id) ON DELETE CASCADE,
  ai_system_version_id  uuid        REFERENCES vectorbea.capability_versions(id) ON DELETE SET NULL,
  evidence_type         text        NOT NULL CHECK (evidence_type IN (
    'prompt_check','deterministic_check','behavioral_check',
    'rag_grounding_check','mcp_tool_policy_check',
    'workflow_regression','provider_comparison',
    'human_approval','privacy_check','security_check'
  )),
  status                text        NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','running','passed','failed','needs_review','cancelled','timed_out'
  )),
  blocking              boolean     NOT NULL DEFAULT true,
  policy_pack_id        uuid        REFERENCES vectorbea.policy_packs(id) ON DELETE SET NULL,
  -- underlying run references (nullable — points to the actual execution)
  underlying_run_id     text,       -- evaluation_run id, workflow_regression_run id, approval_request id etc.
  underlying_run_type   text,       -- 'evaluation_run' | 'workflow_regression' | 'approval_request' | null
  -- result fields
  result_score          numeric,
  result_summary        text,
  failure_reason        text,
  result_metadata       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- provenance
  started_by            text        NOT NULL,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup by workspace + ai_system_version
CREATE INDEX IF NOT EXISTS capability_evidence_runs_workspace_version
  ON vectorbea.capability_evidence_runs (workspace_id, ai_system_version_id);

CREATE INDEX IF NOT EXISTS capability_evidence_runs_workspace_system
  ON vectorbea.capability_evidence_runs (workspace_id, ai_system_id);

-- RLS
ALTER TABLE vectorbea.capability_evidence_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON vectorbea.capability_evidence_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
