-- Workspace-level operating objectives shown by Control and configured in
-- Settings. These are observability targets, distinct from per-agent-job
-- BudgetPolicy enforcement limits.
CREATE TABLE IF NOT EXISTS workspace_control_budgets (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
    reliability_target NUMERIC(6, 5),
    daily_spend_limit_usd NUMERIC(12, 2),
    approval_sla_minutes INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT workspace_control_budget_reliability
      CHECK (reliability_target IS NULL OR reliability_target BETWEEN 0.90 AND 0.99999),
    CONSTRAINT workspace_control_budget_spend
      CHECK (daily_spend_limit_usd IS NULL OR daily_spend_limit_usd > 0),
    CONSTRAINT workspace_control_budget_approval_sla
      CHECK (approval_sla_minutes IS NULL OR approval_sla_minutes BETWEEN 5 AND 10080)
);

