import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getPlanDefinition, normalizePlanTier } from "@/lib/server/plan-config";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { getWorkspacePlanLimits, getWorkspacePromptCount } from "@/lib/server/workspace-limits";
import { getWorkspaceUsage } from "@/lib/server/usage-quotas";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const [limits, promptsUsed, usageSnapshot] = await Promise.all([
      getWorkspacePlanLimits(workspaceId),
      getWorkspacePromptCount(workspaceId),
      getWorkspaceUsage(workspaceId),
    ]);

    const planTier = normalizePlanTier(limits.planTier);
    const plan = getPlanDefinition(planTier);
    const supabase = createVectorBeaAdminClient();

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("organization_id")
      .eq("id", workspaceId)
      .maybeSingle();

    const organizationId = workspace?.organization_id ?? limits.organizationId;
    const [{ data: organization }, { count: seatsUsed }, { count: providerConnections }] = await Promise.all([
      supabase
        .from("organizations")
        .select("id, plan_tier, stripe_customer_id, stripe_subscription_id, max_seats")
        .eq("id", organizationId)
        .maybeSingle(),
      supabase
        .from("org_members")
        .select("user_id", { count: "exact", head: true })
        .eq("organization_id", organizationId),
      supabase
        .from("provider_configs")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
    ]);

    const hasSubscription = Boolean(organization?.stripe_subscription_id);
    const portalUrl =
      process.env.NEXT_PUBLIC_BILLING_PORTAL_URL ??
      process.env.LEMON_SQUEEZY_CUSTOMER_PORTAL_URL ??
      null;

    return NextResponse.json({
      planTier,
      planLabel: plan.label,
      resetAt: usageSnapshot.resetAt,
      promptUsage: {
        used: promptsUsed,
        limit: limits.maxPrompts,
      },
      workspaceLimits: {
        workspaces: plan.limits.workspaces,
        users: limits.maxSeats,
        prompts: limits.maxPrompts,
        environments: plan.limits.environments,
        providerConnections: plan.limits.provider_connections,
        retentionDays: plan.limits.retention_days,
      },
      currentCounts: {
        seatsUsed: seatsUsed ?? null,
        providerConnections: providerConnections ?? 0,
      },
      usage: usageSnapshot.usage,
      usageLimits: usageSnapshot.limits,
      billingSummary: {
        plan: planTier,
        planDisplayName: plan.label,
        status:
          planTier === "free"
            ? "free"
            : hasSubscription
              ? "active"
              : "active_without_subscription",
        billingInterval: planTier === "free" ? null : "monthly",
        pricePerSeat: planTier === "plus" ? plan.monthlyPrice : null,
        originalPricePerSeat: null,
        workspacePrice: planTier === "pro" ? plan.monthlyPrice : null,
        annualWorkspacePrice: planTier === "pro" ? plan.annualMonthlyPrice : null,
        annualPricePerSeat: planTier === "plus" ? plan.annualMonthlyPrice : null,
        currency: planTier === "free" ? null : "USD",
        seatCount: seatsUsed ?? null,
        canUpgrade: planTier !== "enterprise",
        canManageBilling: Boolean(portalUrl),
        canCancel: planTier !== "free" && Boolean(hasSubscription) && Boolean(portalUrl),
        canDowngrade: planTier !== "free" && Boolean(hasSubscription) && Boolean(portalUrl),
        lemonSqueezyCustomerId: organization?.stripe_customer_id ?? null,
        lemonSqueezySubscriptionId: organization?.stripe_subscription_id ?? null,
        portalUrl,
      },
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load billing usage");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
