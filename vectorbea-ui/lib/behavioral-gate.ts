/**
 * Client-safe feature gate for Behavioral Evaluations.
 *
 * Behavioral Evaluations are Pro and Enterprise only.
 * Free and Plus users see a locked / upgrade state.
 */

import type { PlanTier } from "@/lib/api";

export function canUseBehavioralEvaluations(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export function canUseProviderArena(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export const BEHAVIORAL_PLAN_REQUIREMENT = "Pro or Enterprise";
export const PROVIDER_ARENA_PLAN_REQUIREMENT = "Pro or Enterprise";
