import "server-only";

import type { PlanTier } from "@/lib/api";

export type CanonicalPlanTier = "free" | "plus" | "pro" | "enterprise";

export type WorkspaceCountLimit =
  | "workspaces"
  | "users"
  | "prompts"
  | "environments"
  | "provider_connections"
  | "retention_days";

export type UsageMeter =
  | "traces"
  | "replay_runs"
  | "evaluation_executions"
  | "provider_executions"
  | "judge_executions"
  | "scheduled_regression_runs"
  | "provider_arena_runs"
  | "notification_emails";

export type PlanFeature =
  | "evaluations"
  | "golden_traces"
  | "basic_candidate_comparison"
  | "email_notifications"
  | "basic_provider_testing"
  | "behavioral_evaluations"
  | "provider_arena"
  | "scheduled_regressions"
  | "rollout_gates"
  | "slack_alerts"
  | "review_queue"
  | "audit_trail"
  | "multi_provider_comparison"
  | "multi_evaluation_comparison"
  | "production_decision_reports"
  | "sso"
  | "advanced_rbac"
  | "locked_rubrics"
  | "custom_policies"
  | "pii_redaction"
  | "private_deployment"
  | "data_residency"
  | "sla";

export interface PlanDefinition {
  id: CanonicalPlanTier;
  label: string;
  monthlyPrice: number | null;
  annualMonthlyPrice: number | null;
  priceSuffix: string;
  marketingPositioning: string;
  limits: Record<WorkspaceCountLimit, number | null>;
  usageLimits: Record<UsageMeter, number | null>;
  features: Record<PlanFeature, boolean>;
}

function featureSet(enabled: PlanFeature[]): Record<PlanFeature, boolean> {
  const all: PlanFeature[] = [
    "evaluations",
    "golden_traces",
    "basic_candidate_comparison",
    "email_notifications",
    "basic_provider_testing",
    "behavioral_evaluations",
    "provider_arena",
    "scheduled_regressions",
    "rollout_gates",
    "slack_alerts",
    "review_queue",
    "audit_trail",
    "multi_provider_comparison",
    "multi_evaluation_comparison",
    "production_decision_reports",
    "sso",
    "advanced_rbac",
    "locked_rubrics",
    "custom_policies",
    "pii_redaction",
    "private_deployment",
    "data_residency",
    "sla",
  ];

  return Object.fromEntries(
    all.map((feature) => [feature, enabled.includes(feature)]),
  ) as Record<PlanFeature, boolean>;
}

export const PLAN_CONFIG: Record<CanonicalPlanTier, PlanDefinition> = {
  free: {
    id: "free",
    label: "Free",
    monthlyPrice: 0,
    annualMonthlyPrice: 0,
    priceSuffix: "",
    marketingPositioning: "Explore AI risk control",
    limits: {
      workspaces: 1,
      users: 1,
      prompts: 3,
      environments: 1,
      provider_connections: 1,
      retention_days: 7,
    },
    usageLimits: {
      traces: 1_000,
      replay_runs: 25,
      evaluation_executions: 100,
      provider_executions: 0,
      judge_executions: 100,
      scheduled_regression_runs: 0,
      provider_arena_runs: 0,
      notification_emails: 50,
    },
    features: featureSet(["evaluations"]),
  },
  plus: {
    id: "plus",
    label: "Plus",
    monthlyPrice: 29,
    annualMonthlyPrice: 23,
    priceSuffix: "per month",
    marketingPositioning: "Validate LLM features before production",
    limits: {
      workspaces: 1,
      users: 2,
      prompts: 5,
      environments: 2,
      provider_connections: 3,
      retention_days: 30,
    },
    usageLimits: {
      traces: 10_000,
      replay_runs: 250,
      evaluation_executions: 1_000,
      provider_executions: 1_000,
      judge_executions: 1_000,
      scheduled_regression_runs: 0,
      provider_arena_runs: 0,
      notification_emails: 1_000,
    },
    features: featureSet([
      "evaluations",
      "golden_traces",
      "basic_candidate_comparison",
      "email_notifications",
      "basic_provider_testing",
    ]),
  },
  pro: {
    id: "pro",
    label: "Pro",
    monthlyPrice: 499,
    annualMonthlyPrice: 399,
    priceSuffix: "per workspace per month",
    marketingPositioning: "Control production LLM risk",
    limits: {
      workspaces: 3,
      users: 10,
      prompts: 500,
      environments: 25,
      provider_connections: 10,
      retention_days: 90,
    },
    usageLimits: {
      traces: 250_000,
      replay_runs: 5_000,
      evaluation_executions: 25_000,
      provider_executions: 25_000,
      judge_executions: 10_000,
      scheduled_regression_runs: 100,
      provider_arena_runs: 50,
      notification_emails: 10_000,
    },
    features: featureSet([
      "evaluations",
      "golden_traces",
      "basic_candidate_comparison",
      "email_notifications",
      "basic_provider_testing",
      "behavioral_evaluations",
      "provider_arena",
      "scheduled_regressions",
      "rollout_gates",
      "slack_alerts",
      "review_queue",
      "audit_trail",
      "multi_provider_comparison",
      "multi_evaluation_comparison",
      "production_decision_reports",
    ]),
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    monthlyPrice: null,
    annualMonthlyPrice: null,
    priceSuffix: "",
    marketingPositioning: "Govern AI behavior at scale",
    limits: {
      workspaces: null,
      users: null,
      prompts: null,
      environments: null,
      provider_connections: null,
      retention_days: null,
    },
    usageLimits: {
      traces: null,
      replay_runs: null,
      evaluation_executions: null,
      provider_executions: null,
      judge_executions: null,
      scheduled_regression_runs: null,
      provider_arena_runs: null,
      notification_emails: null,
    },
    features: featureSet([
      "evaluations",
      "golden_traces",
      "basic_candidate_comparison",
      "email_notifications",
      "basic_provider_testing",
      "behavioral_evaluations",
      "provider_arena",
      "scheduled_regressions",
      "rollout_gates",
      "slack_alerts",
      "review_queue",
      "audit_trail",
      "multi_provider_comparison",
      "multi_evaluation_comparison",
      "production_decision_reports",
      "sso",
      "advanced_rbac",
      "locked_rubrics",
      "custom_policies",
      "pii_redaction",
      "private_deployment",
      "data_residency",
      "sla",
    ]),
  },
};

export function normalizePlanTier(planTier?: PlanTier | string | null): CanonicalPlanTier {
  if (planTier === "enterprise") return "enterprise";
  if (planTier === "pro") return "pro";
  if (planTier === "plus" || planTier === "team") return "plus";
  return "free";
}

export function getPlanDefinition(planTier?: PlanTier | string | null): PlanDefinition {
  return PLAN_CONFIG[normalizePlanTier(planTier)];
}

export function isFeatureEnabled(planTier: PlanTier | string | null | undefined, feature: PlanFeature) {
  return getPlanDefinition(planTier).features[feature];
}

export function getPlanUsageLimit(planTier: PlanTier | string | null | undefined, meter: UsageMeter) {
  return getPlanDefinition(planTier).usageLimits[meter];
}
