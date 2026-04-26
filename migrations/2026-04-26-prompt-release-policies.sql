-- Prompt Release Policies
-- Defines per-prompt evaluation gates that must pass before a version can be
-- promoted to Candidate or Active. Checked at promotion time by the rollout API.

CREATE TABLE IF NOT EXISTS prompt_release_policies (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              UUID        NOT NULL,
  prompt_id                 UUID        NOT NULL,

  -- Minimum aggregate evaluation score (0.0–1.0). NULL = no minimum.
  min_score                 NUMERIC(4,3),

  -- All critical checks must pass before promotion is allowed.
  require_critical_pass     BOOLEAN     NOT NULL DEFAULT true,

  -- Maximum number of regression items allowed (0 = zero tolerance).
  max_regression_count      INTEGER     DEFAULT 0,

  -- Block promotion if ANY item fails (stricter than score threshold alone).
  block_on_any_failure      BOOLEAN     NOT NULL DEFAULT false,

  -- Require that structured JSON output is valid where expected.
  require_json_valid        BOOLEAN     NOT NULL DEFAULT false,

  -- Block if any safety/refusal checks fail.
  require_no_safety_failures BOOLEAN   NOT NULL DEFAULT true,

  -- Maximum allowed latency increase vs baseline (%). NULL = no limit.
  max_latency_increase_pct  INTEGER,

  -- Maximum allowed cost/token increase vs baseline (%). NULL = no limit.
  max_cost_increase_pct     INTEGER,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT prompt_release_policies_prompt_id_key UNIQUE (prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_release_policies_workspace
  ON prompt_release_policies(workspace_id);

CREATE INDEX IF NOT EXISTS idx_prompt_release_policies_prompt
  ON prompt_release_policies(prompt_id);

-- RLS: workspace members can read/write their own policies
ALTER TABLE prompt_release_policies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'prompt_release_policies'
    AND policyname  = 'workspace_member_access'
  ) THEN
    CREATE POLICY workspace_member_access ON prompt_release_policies
      USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members
          WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;
