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

export function canUseAICapabilities(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export function canUseWorkflowReliability(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export function canUseDeterministicRules(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export function canUseAdvancedReliabilityReports(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export function canUseRoiDashboard(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export function canUseAdvancedRoiReports(planTier: PlanTier | null | undefined): boolean {
  return planTier === "enterprise";
}

export function canUseIncidents(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export function canUseGovernanceDashboard(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export function canUseApprovalWorkflows(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export function canUsePolicyPacks(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export function canUsePrivacyControls(planTier: PlanTier | null | undefined): boolean {
  return planTier === "pro" || planTier === "enterprise";
}

export const BEHAVIORAL_PLAN_REQUIREMENT = "Pro or Enterprise";
export const PROVIDER_ARENA_PLAN_REQUIREMENT = "Pro or Enterprise";
export const AI_CAPABILITIES_PLAN_REQUIREMENT = "Pro or Enterprise";
export const WORKFLOW_RELIABILITY_PLAN_REQUIREMENT = "Pro or Enterprise";
