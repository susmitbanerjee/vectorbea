import { NextRequest, NextResponse } from "next/server";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { requireNewWorkspaceAllowed } from "@/lib/server/entitlements";
import { requireAuthenticatedUser } from "@/lib/server/settings-auth";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as {
      name?: string;
      organizationId?: string;
    };
    const name = payload.name?.trim();
    const organizationId = payload.organizationId?.trim();

    if (!name) {
      return NextResponse.json(
        { error: "Workspace name is required" },
        { status: 400 },
      );
    }

    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId is required" },
        { status: 400 },
      );
    }

    /*
     * `max_workspaces`, before anything is created.
     *
     * The acceptance criterion is that an account at its ceiling cannot create
     * another "by API or UI". The Kotlin `POST /api/workspaces` is the API door;
     * this is the one the workspace switcher uses, and a limit enforced on only
     * one of two doors is not a limit.
     *
     * Resolved through a workspace the caller OWNS, never one they were invited
     * to — see `requireNewWorkspaceAllowed`.
     */
    const auth = await requireAuthenticatedUser(request, "create a workspace");
    if (auth.error) return auth.error;
    await requireNewWorkspaceAllowed(auth.user.id);

    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("workspaces")
      .insert([{ name, organization_id: organizationId }])
      .select("id, organization_id, name, created_at")
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        id: data.id,
        organizationId: data.organization_id,
        name: data.name,
        createdAt: data.created_at,
      },
      { status: 201 },
    );
  } catch (error) {
    /*
     * `toSafeApiError` recognises a `PlanLimitError` and passes its numbers
     * through, so the switcher can say "the Free plan allows 1 workspace" and
     * offer the upgrade — rather than the generic 500 this used to return for
     * every failure, which would have made a correct refusal look like an outage.
     */
    const safe = toSafeApiError(error, "Failed to create workspace");
    return NextResponse.json(
      { error: safe.message, code: safe.code, ...(safe.detail ?? {}) },
      { status: safe.status },
    );
  }
}
