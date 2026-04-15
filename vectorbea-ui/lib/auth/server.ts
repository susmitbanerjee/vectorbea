import "server-only";

import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import type {
  OrganizationView,
  OrganizationWorkspaceView,
  PlanTier,
  WorkspaceRole,
} from "@/lib/api";
import {
  createSupabaseAdminClient,
  createVectorBeaAdminClient,
} from "@/lib/supabase-admin";

type BillingOrgRecord = {
  id: string;
  name: string;
  created_at: string | null;
  plan_tier?: PlanTier | null;
  max_seats?: number | null;
  max_prompts?: number | null;
  monthly_audit_limit?: number | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
};

type WorkspaceMembershipRecord = {
  role?: WorkspaceRole | null;
  workspaces?: {
    id: string;
    name: string;
    organization_id: string;
    organizations?: BillingOrgRecord | BillingOrgRecord[] | null;
  } | null;
};

export function getAccessTokenFromCookies(
  cookieStore: Pick<ReadonlyRequestCookies, "get">,
) {
  return cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
}

export async function getAuthenticatedUserForAccessToken(accessToken: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function getAuthenticatedUserFromCookies(
  cookieStore: Pick<ReadonlyRequestCookies, "get">,
) {
  const accessToken = getAccessTokenFromCookies(cookieStore);
  if (!accessToken) {
    return null;
  }

  return getAuthenticatedUserForAccessToken(accessToken);
}

function normalizePlanTier(planTier?: PlanTier | null): PlanTier {
  if (planTier === "team" || planTier === "pro" || planTier === "enterprise") {
    return planTier;
  }
  return "free";
}

function normalizeWorkspaceRole(role?: WorkspaceRole | null): WorkspaceRole {
  if (role === "admin" || role === "editor" || role === "viewer") {
    return role;
  }
  return "viewer";
}

function isBillingPending(org: OrganizationView) {
  return (
    org.planTier !== "free" &&
    !org.stripeCustomerId &&
    !org.stripeSubscriptionId
  );
}

export async function upsertProfile(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const email = user.email?.trim();
  if (!email) return;
  const meta = user.user_metadata ?? {};
  const fullName =
    ((meta.full_name ?? meta.name ?? meta.user_name) as string | undefined)?.trim() ?? null;
  const avatarUrl =
    ((meta.avatar_url ?? meta.picture) as string | undefined)?.trim() ?? null;
  await createVectorBeaAdminClient()
    .from("profiles")
    .upsert({ id: user.id, email, full_name: fullName, avatar_url: avatarUrl }, { onConflict: "id" });
}

export async function loadProfileForUser(userId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url")
    .eq("id", userId)
    .single();
  return data as { id: string; email: string; full_name: string | null; avatar_url: string | null } | null;
}

export async function loadOrganizationsForUser(
  userId: string,
): Promise<OrganizationView[]> {
  const supabase = createVectorBeaAdminClient();
  const { data: memberships, error } = await supabase
    .from("workspace_members")
    .select(
      "role, workspaces!inner(id, name, organization_id, organizations!inner(id, name, created_at, plan_tier, max_seats, max_prompts, monthly_audit_limit, stripe_customer_id, stripe_subscription_id))",
    )
    .eq("user_id", userId)
    .returns<WorkspaceMembershipRecord[]>();

  if (error) {
    throw new Error(`Failed to load workspace memberships: ${error.message}`);
  }

  if (!memberships?.length) {
    return [];
  }

  const organizations = new Map<string, OrganizationView>();
  const order: string[] = [];

  for (const membership of memberships) {
    const workspace = membership.workspaces;
    if (!workspace) {
      continue;
    }

    const organizationRecord = Array.isArray(workspace.organizations)
      ? workspace.organizations[0]
      : workspace.organizations;

    if (!organizationRecord) {
      continue;
    }

    if (!organizations.has(organizationRecord.id)) {
      organizations.set(organizationRecord.id, {
        id: organizationRecord.id,
        name: organizationRecord.name,
        createdAt: organizationRecord.created_at ?? null,
        role: normalizeWorkspaceRole(membership.role),
        workspaceRole: normalizeWorkspaceRole(membership.role),
        workspaces: [],
        planTier: normalizePlanTier(organizationRecord.plan_tier),
        maxSeats: organizationRecord.max_seats ?? 1,
        maxPrompts: organizationRecord.max_prompts ?? 5,
        monthlyAuditLimit: organizationRecord.monthly_audit_limit ?? 100,
        currentUsers: 0,
        stripeCustomerId: organizationRecord.stripe_customer_id ?? null,
        stripeSubscriptionId: organizationRecord.stripe_subscription_id ?? null,
        billingPortalUrl:
          process.env.NEXT_PUBLIC_BILLING_PORTAL_URL ??
          process.env.LEMON_SQUEEZY_CUSTOMER_PORTAL_URL ??
          null,
      });
      order.push(organizationRecord.id);
    }

    const organization = organizations.get(organizationRecord.id)!;
    const workspaceView: OrganizationWorkspaceView = {
      id: workspace.id,
      name: workspace.name,
      role: normalizeWorkspaceRole(membership.role),
      organizationId: organizationRecord.id,
      organizationName: organizationRecord.name,
    };

    if (!organization.workspaces?.some((item) => item.id === workspaceView.id)) {
      organization.workspaces = [...(organization.workspaces ?? []), workspaceView];
    }
  }

  const orgIds = order;
  const { data: orgMembers } = await supabase
    .from("org_members")
    .select("organization_id, user_id")
    .in("organization_id", orgIds);

  const counts = new Map<string, number>();
  for (const member of orgMembers ?? []) {
    counts.set(
      member.organization_id,
      (counts.get(member.organization_id) ?? 0) + 1,
    );
  }

  return order.map((orgId) => ({
    ...organizations.get(orgId)!,
    currentUsers: counts.get(orgId) ?? 0,
  }));
}

export async function getPostLoginRedirectForUser(userId: string) {
  const organizations = await loadOrganizationsForUser(userId);
  const firstWorkspaceId = organizations[0]?.workspaces?.[0]?.id ?? null;

  if (!firstWorkspaceId) {
    return {
      redirectTo: "/onboarding",
      organizations,
    };
  }

  if (organizations.some(isBillingPending)) {
    return {
      redirectTo: "/settings/billing",
      organizations,
    };
  }

  return {
    redirectTo: `/dashboard?org=${encodeURIComponent(firstWorkspaceId)}`,
    organizations,
  };
}
