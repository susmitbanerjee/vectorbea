import "server-only";

import type { PlanTier } from "@/lib/api";
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
  | "enterprise_rubric_locking";

type FeaturePolicy = Record<PlanTier, boolean>;

const FEATURE_POLICY: Record<FeatureKey, FeaturePolicy> = {
  evaluations: {
    free: false,
    team: true,
    pro: true,
    enterprise: true,
  },
  scheduled_regressions: {
    free: false,
    team: true,
    pro: true,
    enterprise: true,
  },
  rollout: {
    free: false,
    team: true,
    pro: true,
    enterprise: true,
  },
  alerts: {
    free: false,
    team: true,
    pro: true,
    enterprise: true,
  },
  metrics_dashboard: {
    free: true,
    team: true,
    pro: true,
    enterprise: true,
  },
  enterprise_gateway: {
    free: false,
    team: false,
    pro: false,
    enterprise: true,
  },
  slack_notifications: {
    free: false,
    team: true,
    pro: true,
    enterprise: true,
  },
  email_notifications: {
    free: false,
    team: true,
    pro: true,
    enterprise: true,
  },
  team_invitations: {
    free: true,
    team: true,
    pro: true,
    enterprise: true,
  },
  auto_evaluations: {
    free: false,
    team: true,
    pro: true,
    enterprise: true,
  },
  behavioral_evaluations: {
    free: false,
    team: false,
    pro: true,
    enterprise: true,
  },
  provider_arena: {
    free: false,
    team: false,
    pro: true,
    enterprise: true,
  },
  evaluation_comparison: {
    free: false,
    team: false,
    pro: true,
    enterprise: true,
  },
  human_review_queue: {
    free: false,
    team: false,
    pro: true,
    enterprise: true,
  },
  rollout_decision_reports: {
    free: false,
    team: false,
    pro: true,
    enterprise: true,
  },
  enterprise_rubric_locking: {
    free: false,
    team: false,
    pro: false,
    enterprise: true,
  },
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
    default:
      return "Feature";
  }
}

export async function canUseFeature(workspaceId: string, feature: FeatureKey) {
  const limits = await getWorkspacePlanLimits(workspaceId);
  const allowed = FEATURE_POLICY[feature][limits.planTier] ?? false;
  return {
    allowed,
    planTier: limits.planTier,
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
