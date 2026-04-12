import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  getAuthenticatedUserFromCookies,
  loadOrganizationsForUser,
} from "@/lib/auth/server";
import type { OrganizationView } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);

    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const organizations = await loadOrganizationsForUser(user.id);
    return NextResponse.json(organizations);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load organizations",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);

    if (!user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    const payload = (await request.json()) as { name?: string };
    const name = payload.name?.trim();

    if (!name) {
      return NextResponse.json(
        { error: "Organization name is required." },
        { status: 400 },
      );
    }

    const existingOrganizations = await loadOrganizationsForUser(user.id);
    const currentTier = existingOrganizations[0]?.planTier ?? "free";
    if (currentTier === "free" && existingOrganizations.length >= 1) {
      return NextResponse.json(
        {
          error:
            "Free tier is limited to 1 Organization. Please upgrade to the Team plan.",
        },
        { status: 403 },
      );
    }

    const supabase = createVectorBeaAdminClient();
    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .insert({
        name,
        plan_tier: "free",
        max_seats: 1,
        max_prompts: 5,
        monthly_audit_limit: 100,
      })
      .select("id, name, created_at")
      .single();

    if (organizationError || !organization) {
      throw new Error(
        organizationError?.message ?? "Failed to create organization",
      );
    }

    const { error: orgMembershipError } = await supabase.from("org_members").insert({
      organization_id: organization.id,
      user_id: user.id,
      role: "owner",
    });

    if (orgMembershipError) {
      throw new Error(orgMembershipError.message);
    }

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .insert({
        organization_id: organization.id,
        name,
      })
      .select("id, name, organization_id")
      .single();

    if (workspaceError || !workspace) {
      throw new Error(workspaceError?.message ?? "Failed to create workspace");
    }

    const { error: workspaceMembershipError } = await supabase
      .from("workspace_members")
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: "admin",
      });

    if (workspaceMembershipError) {
      throw new Error(workspaceMembershipError.message);
    }

    const response: OrganizationView & { workspaceId: string } = {
      id: workspace.id,
      workspaceId: workspace.id,
      name: organization.name,
      createdAt: organization.created_at,
      role: "admin",
      workspaceRole: "admin",
      planTier: "free",
      maxSeats: 1,
      maxPrompts: 5,
      monthlyAuditLimit: 100,
      currentUsers: 1,
      workspaces: [
        {
          id: workspace.id,
          name: workspace.name,
          role: "admin",
          organizationId: organization.id,
          organizationName: organization.name,
        },
      ],
      billingPortalUrl:
        process.env.NEXT_PUBLIC_BILLING_PORTAL_URL ??
        process.env.LEMON_SQUEEZY_CUSTOMER_PORTAL_URL ??
        null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create organization",
      },
      { status: 500 },
    );
  }
}
