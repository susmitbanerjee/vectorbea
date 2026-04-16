import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import {
  getAuthenticatedUserFromCookies,
  loadOrganizationsForUser,
} from "@/lib/auth/server";
import {
  createSupabaseAdminClient,
  createVectorBeaAdminClient,
} from "@/lib/supabase-admin";

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

    // ── Free plan gate ──────────────────────────────────────────────────────
    const existingOrganizations = await loadOrganizationsForUser(user.id).catch(() => []);
    if (
      existingOrganizations.length > 0 &&
      (existingOrganizations[0]?.planTier ?? "free") === "free"
    ) {
      return NextResponse.json(
        { error: "Free tier is limited to 1 Organization. Please upgrade to the Team plan." },
        { status: 403 },
      );
    }

    // ── Validate payload ────────────────────────────────────────────────────
    const payload = (await request.json()) as { workspaceName?: string };
    const workspaceName = payload.workspaceName?.trim();
    if (!workspaceName) {
      return NextResponse.json({ error: "workspaceName is required" }, { status: 400 });
    }

    // ── Single transactional RPC ────────────────────────────────────────────
    //
    // Replaces 4 sequential inserts. If any step inside the Postgres function
    // fails the entire transaction is rolled back — no orphaned org rows.
    const supabase = createSupabaseAdminClient();

    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "create_tenant_environment",
      {
        p_user_id:        user.id,
        p_org_name:       workspaceName,   // org name = workspace name on first signup
        p_workspace_name: workspaceName,
        p_plan_tier:      "free",
      },
    );

    if (rpcError || !rpcResult) {
      throw new Error(rpcError?.message ?? "Transactional tenant creation failed");
    }

    const { organization_id, workspace_id } = rpcResult as TenantEnvironmentResult;

    // ── Provision the onboarding API key ────────────────────────────────────
    //
    // This insert is intentionally outside the RPC because it is not a
    // structural integrity concern — a missing API key does not corrupt the
    // tenant topology. If it fails we still return success; the user can
    // generate a key from the dashboard.
    const vectorbea = createVectorBeaAdminClient();
    const generatedKey = generateApiKey();

    await vectorbea
      .from("api_keys")
      .insert({
        workspace_id:  workspace_id,
        key_name:      "onboarding-key",
        key_hash:      generatedKey.hash,
        key_last_four: generatedKey.lastFour,
        key_role:      "admin",
      })
      .then(({ error }) => {
        if (error) {
          console.warn("[onboarding/bootstrap] api_keys insert failed (non-fatal):", error.message);
        }
      });

    return NextResponse.json(
      {
        organizationId: organization_id,
        workspaceId:    workspace_id,
        apiKey:         generatedKey.rawKey,
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to bootstrap onboarding" },
      { status: 500 },
    );
  }
}
