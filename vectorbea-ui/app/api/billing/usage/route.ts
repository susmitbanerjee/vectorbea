import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { canUseFeature } from "@/lib/server/feature-gates";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import {
  getWorkspaceMonthlyAuditCount,
  getWorkspacePlanLimits,
  getWorkspacePromptCount,
} from "@/lib/server/workspace-limits";
import { getWorkspaceUsage } from "@/lib/server/usage-quotas";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 },
      );
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const [limits, promptsUsed, auditsUsed, usageSnapshot, evalFeature, rolloutFeature, alertsFeature] = await Promise.all([
      getWorkspacePlanLimits(workspaceId),
      getWorkspacePromptCount(workspaceId),
      getWorkspaceMonthlyAuditCount(workspaceId),
      getWorkspaceUsage(workspaceId),
      canUseFeature(workspaceId, "evaluations"),
      canUseFeature(workspaceId, "rollout"),
      canUseFeature(workspaceId, "alerts"),
    ]);

    const supabase = createVectorBeaAdminClient();
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("organization_id")
      .eq("id", workspaceId)
      .maybeSingle();

    const organizationId = workspace?.organization_id ?? limits.organizationId;
    const [{ data: organization }, { count: seatsUsed }] = await Promise.all([
      supabase
        .from("organizations")
        .select("id, plan_tier, stripe_customer_id, stripe_subscription_id, max_seats")
        .eq("id", organizationId)
        .maybeSingle(),
      supabase
        .from("org_members")
        .select("user_id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
    ]);

    const planTier = (organization?.plan_tier ?? limits.planTier) as "free" | "team" | "pro" | "enterprise";
    const hasSubscription = Boolean(organization?.stripe_subscription_id);
    const portalUrl =
      process.env.NEXT_PUBLIC_BILLING_PORTAL_URL ??
      process.env.LEMON_SQUEEZY_CUSTOMER_PORTAL_URL ??
      null;

    const billingSummary = {
      plan: planTier,
      planDisplayName:
        planTier === "enterprise"
          ? "Enterprise"
          : planTier === "pro"
            ? "Pro"
            : planTier === "team"
              ? "Team"
              : "Free",
      status:
        planTier === "free"
          ? "free"
          : hasSubscription
            ? "active"
            : "active_without_subscription",
      billingInterval: planTier === "free" ? null : "monthly",
      pricePerSeat:
        planTier === "team"
          ? 19.99
          : planTier === "pro"
            ? 29
            : null,
      originalPricePerSeat: planTier === "team" ? 29 : null,
      currency: planTier === "free" ? null : "USD",
      seatCount: seatsUsed ?? null,
      canUpgrade: planTier === "free",
      canManageBilling: Boolean(portalUrl),
      canCancel: planTier !== "free" && Boolean(hasSubscription) && Boolean(portalUrl),
      canDowngrade: planTier !== "free" && Boolean(hasSubscription) && Boolean(portalUrl),
      lemonSqueezyCustomerId: organization?.stripe_customer_id ?? null,
      lemonSqueezySubscriptionId: organization?.stripe_subscription_id ?? null,
      portalUrl,
    };

    return NextResponse.json({
      planTier,
      promptsUsed,
      promptLimit: limits.maxPrompts,
      auditsUsed,
      auditLimit: limits.monthlyAuditLimit,
      seatsUsed: seatsUsed ?? null,
      seatLimit: limits.maxSeats,
      usage: usageSnapshot.usage,
      usageLimits: usageSnapshot.limits,
      features: {
        evaluations: evalFeature.allowed,
        rollout: rolloutFeature.allowed,
        alerts: alertsFeature.allowed,
      },
      billingSummary,
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load billing usage");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
