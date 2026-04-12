import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  getAuthenticatedUserFromCookies,
  loadOrganizationsForUser,
} from "@/lib/auth/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function generateApiKey() {
  const rawKey = `vb_${randomBytes(32).toString("base64url")}`;
  return {
    rawKey,
    hash: createHash("sha256").update(rawKey).digest("hex"),
    lastFour: rawKey.slice(-4),
  };
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

    const existingOrganizations = await loadOrganizationsForUser(user.id);
    if (existingOrganizations.length > 0) {
      return NextResponse.json(
        { error: "Workspace already exists for this user." },
        { status: 409 },
      );
    }

    const payload = (await request.json()) as { workspaceName?: string };
    const workspaceName = payload.workspaceName?.trim();

    if (!workspaceName) {
      return NextResponse.json(
        { error: "workspaceName is required" },
        { status: 400 },
      );
    }

    const supabase = createSupabaseAdminClient();

    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .insert({
        name: workspaceName,
        plan_tier: "free",
        max_seats: 1,
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
        name: workspaceName,
      })
      .select("id, name, organization_id, created_at")
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

    const generatedKey = generateApiKey();
    const { error: apiKeyError } = await supabase.from("api_keys").insert({
      workspace_id: workspace.id,
      key_name: "onboarding-key",
      key_hash: generatedKey.hash,
      key_last_four: generatedKey.lastFour,
      key_role: "admin",
    });

    if (apiKeyError) {
      throw new Error(apiKeyError.message);
    }

    return NextResponse.json(
      {
        organizationId: organization.id,
        workspaceId: workspace.id,
        apiKey: generatedKey.rawKey,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to bootstrap onboarding",
      },
      { status: 500 },
    );
  }
}
