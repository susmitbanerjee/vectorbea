import "server-only";

import type { PlanTier } from "@/lib/api";
import { isFeatureEnabled, normalizePlanTier, type PlanFeature } from "@/lib/server/plan-config";
import { getWorkspacePlanLimits } from "@/lib/server/workspace-limits";

export type FeatureKey =
  | "evaluations"
  | "scheduled_regressions"
  | "rollout"
  | "alerts"
  | "metrics_dashboard"
  | "enterprise_gateway"
  | "slack_notifications"
  | "email_notifications"
  | "team_invitations"
  | "auto_evaluations"
  | "behavioral_evaluations"
  | "provider_arena"
  | "evaluation_comparison"
  | "human_review_queue"
  | "rollout_decision_reports"
  | "enterprise_rubric_locking"
  | "locked_rubrics"
  | "sso"
  | "ai_capabilities"
  | "workflow_reliability"
  | "deterministic_rules"
  | "advanced_reliability_reports"
  | "roi_dashboard"
  | "advanced_roi_reports";

const FEATURE_MAP: Record<FeatureKey, PlanFeature | null> = {
  evaluations: "evaluations",
  scheduled_regressions: "scheduled_regressions",
  rollout: "rollout_gates",
  alerts: "email_notifications",
  metrics_dashboard: null,
  enterprise_gateway: "private_deployment",
  slack_notifications: "slack_alerts",
  email_notifications: "email_notifications",
  team_invitations: null,
  auto_evaluations: "scheduled_regressions",
  behavioral_evaluations: "behavioral_evaluations",
  provider_arena: "provider_arena",
  evaluation_comparison: "multi_evaluation_comparison",
  human_review_queue: "review_queue",
  rollout_decision_reports: "production_decision_reports",
  enterprise_rubric_locking: "locked_rubrics",
  locked_rubrics: "locked_rubrics",
  sso: "sso",
  ai_capabilities: "behavioral_evaluations",
  workflow_reliability: "behavioral_evaluations",
  deterministic_rules: "behavioral_evaluations",
  advanced_reliability_reports: "production_decision_reports",
  roi_dashboard: "roi_dashboard",
  advanced_roi_reports: "advanced_roi_reports",
};

function labelFor(feature: FeatureKey) {
  switch (feature) {
    case "evaluations":
      return "Evaluations";
    case "scheduled_regressions":
      return "Scheduled regressions";
    case "rollout":
      return "Rollout controls";
    case "alerts":
      return "Alerting";
    case "metrics_dashboard":
      return "Metrics dashboard";
    case "enterprise_gateway":
      return "Enterprise gateway execution";
    case "slack_notifications":
      return "Slack notifications";
    case "email_notifications":
      return "Email notifications";
    case "team_invitations":
      return "Team invitations";
    case "auto_evaluations":
      return "Automatic evaluations";
    case "behavioral_evaluations":
      return "Behavioral evaluations";
    case "provider_arena":
      return "Provider Arena";
    case "evaluation_comparison":
      return "Evaluation comparison";
    case "human_review_queue":
      return "Human review queue";
    case "rollout_decision_reports":
      return "Rollout decision reports";
    case "enterprise_rubric_locking":
      return "Enterprise rubric locking";
    case "ai_capabilities":
      return "AI Capabilities";
    case "workflow_reliability":
      return "Workflow reliability";
    case "deterministic_rules":
      return "Deterministic rule engine";
    case "advanced_reliability_reports":
      return "Advanced reliability reports";
    case "roi_dashboard":
      return "ROI dashboard";
    case "advanced_roi_reports":
      return "Advanced ROI reports";
    default:
      return "Feature";
  }
}

export async function canUseFeature(workspaceId: string, feature: FeatureKey) {
  const limits = await getWorkspacePlanLimits(workspaceId);
  const normalizedPlan = normalizePlanTier(limits.planTier);
  const mappedFeature = FEATURE_MAP[feature];
  const allowed = mappedFeature ? isFeatureEnabled(normalizedPlan, mappedFeature) : true;
  return {
    allowed,
    planTier: normalizedPlan,
    reason: allowed ? null : `${labelFor(feature)} requires a higher plan`,
  };
}

export async function assertFeatureAccess(workspaceId: string, feature: FeatureKey) {
  const result = await canUseFeature(workspaceId, feature);
  if (!result.allowed) {
    throw new Error(`${labelFor(feature)} is not available on the ${result.planTier} plan.`);
  }
  return result;
}

export async function canUseBehavioralEvaluations(workspaceId: string) {
  return canUseFeature(workspaceId, "behavioral_evaluations");
}

export async function canUseProviderArena(workspaceId: string) {
  return canUseFeature(workspaceId, "provider_arena");
}

export async function canUseScheduledRegressions(workspaceId: string) {
  return canUseFeature(workspaceId, "scheduled_regressions");
}

export async function canUseRolloutGates(workspaceId: string) {
  return canUseFeature(workspaceId, "rollout");
}

export async function canUseSlackAlerts(workspaceId: string) {
  return canUseFeature(workspaceId, "slack_notifications");
}

export async function canUseReviewQueue(workspaceId: string) {
  return canUseFeature(workspaceId, "human_review_queue");
}

export async function canUseAuditTrail(workspaceId: string) {
  return canUseFeature(workspaceId, "rollout_decision_reports");
}

export async function canUseMultiProviderComparison(workspaceId: string) {
  return canUseFeature(workspaceId, "provider_arena");
}

export async function canUseMultiEvaluationComparison(workspaceId: string) {
  return canUseFeature(workspaceId, "evaluation_comparison");
}

export async function canUseLockedRubrics(workspaceId: string) {
  return canUseFeature(workspaceId, "locked_rubrics");
}

export async function canUseSSO(workspaceId: string) {
  return canUseFeature(workspaceId, "sso");
}

export async function canUseAICapabilitiesFeature(workspaceId: string) {
  return canUseFeature(workspaceId, "ai_capabilities");
}

export async function canUseWorkflowReliabilityFeature(workspaceId: string) {
  return canUseFeature(workspaceId, "workflow_reliability");
}

export async function canUseDeterministicRulesFeature(workspaceId: string) {
  return canUseFeature(workspaceId, "deterministic_rules");
}

export async function canUseAdvancedReliabilityReportsFeature(workspaceId: string) {
  return canUseFeature(workspaceId, "advanced_reliability_reports");
}

export async function canUseRoiDashboardFeature(workspaceId: string) {
  return canUseFeature(workspaceId, "roi_dashboard");
}

export async function canUseAdvancedRoiReportsFeature(workspaceId: string) {
  return canUseFeature(workspaceId, "advanced_roi_reports");
}
