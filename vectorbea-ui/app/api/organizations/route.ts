import { cookies } from "next/headers";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import type { OrganizationView } from "@/lib/api";
import { organizationTag, WORKSPACES_TAG, workspaceTag } from "@/lib/dal/cache-tags";
import {
  getAuthenticatedUserFromCookies,
  loadOrganizationsForUser,
} from "@/lib/auth/server";
import { createSupabaseAdminClient, createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── GET /api/organizations ───────────────────────────────────────────────────

export async function GET() {
  try {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const organizations = await loadOrganizationsForUser(user.id);
    return NextResponse.json(organizations);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load organizations" },
      { status: 500 },
    );
  }
}

// ─── POST /api/organizations ──────────────────────────────────────────────────

type CreateOrgPayload = {
  name?: string;
  workspaceName?: string;
};

type TenantEnvironmentResult = {
  organization_id: string;
  workspace_id: string;
};

export async function POST(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // ── Validate payload ────────────────────────────────────────────────────
    const payload = (await request.json()) as CreateOrgPayload;
    const orgName = payload.name?.trim();
    if (!orgName) {
      return NextResponse.json(
        { error: "Organization name is required." },
        { status: 400 },
      );
    }
    // Workspace defaults to the org name when not explicitly provided.
    const workspaceName = payload.workspaceName?.trim() || orgName;

    // ── Plan gate ───────────────────────────────────────────────────────────
    const existingOrganizations = await loadOrganizationsForUser(user.id).catch(() => []);
    const currentTier = existingOrganizations[0]?.planTier ?? "free";
    if (currentTier === "free" && existingOrganizations.length >= 1) {
      return NextResponse.json(
        { error: "Free tier is limited to 1 Organization. Please upgrade to the Team plan." },
        { status: 403 },
      );
    }

    const planTier = currentTier;

    // ── Single transactional RPC ────────────────────────────────────────────
    //
    // Replaces 4 separate REST inserts that previously left the database in a
    // corrupted state when any intermediate step failed. The Postgres function
    // `vectorbea.create_tenant_environment` wraps all four inserts in one
    // implicit PL/pgSQL transaction — any error rolls back the entire unit.
    //
    // The RPC is called via the *base* admin client (not the schema-scoped
    // one) because Supabase's .rpc() targets the public PostgREST schema
    // root — the function itself lives in vectorbea schema and handles its
    // own schema-qualified inserts internally.
    const supabase = createSupabaseAdminClient();

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "create_tenant_environment",
      {
        p_user_id:        user.id,
        p_org_name:       orgName,
        p_workspace_name: workspaceName,
        p_plan_tier:      planTier,
      },
    );

    if (rpcError || !rpcResult) {
      throw new Error(rpcError?.message ?? "Transactional org creation failed");
    }

    const { organization_id, workspace_id } = rpcResult as TenantEnvironmentResult;

    // ── Fetch the newly created org for the response payload ────────────────
    const vectorbea = createVectorBeaAdminClient();
    const { data: org } = await vectorbea
      .from("organizations")
      .select("id, name, created_at, plan_tier, max_seats, max_prompts, monthly_audit_limit")
      .eq("id", organization_id)
      .single();

    // ── Build a clean, explicitly-shaped response ───────────────────────────
    const response: OrganizationView & {
      organizationId: string;
      workspaceId: string;
    } = {
      // Explicit top-level IDs — no ambiguity about which ID is which
      organizationId: organization_id,
      workspaceId:    workspace_id,

      // OrganizationView shape for context consumers
      id:                  organization_id,
      name:                org?.name ?? orgName,
      createdAt:           org?.created_at ?? null,
      role:                "admin" as OrganizationView["role"],
      workspaceRole:       "admin" as OrganizationView["workspaceRole"],
      planTier:            (org?.plan_tier as OrganizationView["planTier"]) ?? planTier,
      maxSeats:            org?.max_seats ?? 1,
      maxPrompts:          org?.max_prompts ?? 5,
      monthlyAuditLimit:   org?.monthly_audit_limit ?? 100,
      currentUsers:        1,
      workspaces: [
        {
          id:               workspace_id,
          name:             workspaceName,
          role:             "admin",
          organizationId:   organization_id,
          organizationName: org?.name ?? orgName,
        },
      ],
      billingPortalUrl:
        process.env.NEXT_PUBLIC_BILLING_PORTAL_URL ??
        process.env.LEMON_SQUEEZY_CUSTOMER_PORTAL_URL ??
        null,
      stripeCustomerId:     null,
      stripeSubscriptionId: null,
    };

    revalidateTag(WORKSPACES_TAG);
    revalidateTag(organizationTag(organization_id));
    revalidateTag(workspaceTag(workspace_id));

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create organization" },
      { status: 500 },
    );
  }
}
