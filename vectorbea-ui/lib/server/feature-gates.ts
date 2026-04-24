import "server-only";

import type { PlanTier } from "@/lib/api";
import { getWorkspacePlanLimits } from "@/lib/server/workspace-limits";

export type FeatureKey =
  | "evaluations"
  | "scheduled_regressions"
  | "rollout"
  | "alerts"
  | "metrics_dashboard"
  | "enterprise_gateway";

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

