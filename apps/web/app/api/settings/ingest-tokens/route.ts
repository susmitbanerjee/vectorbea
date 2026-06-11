import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createIngestToken, listIngestTokens } from "@/lib/server/ingest-tokens";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

async function assertEditorOrAdmin(workspaceId: string, userId: string): Promise<boolean> {
  const supabase = createVectorBeaAdminClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role === "admin";
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ items: [] });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const canManage = await assertEditorOrAdmin(workspaceId, auth.user.id);
    if (!canManage) {
      return NextResponse.json({ error: "Only workspace admins can view ingest tokens" }, { status: 403 });
    }
    const tokens = await listIngestTokens(workspaceId);
    return NextResponse.json({ items: tokens });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to list ingest tokens");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const canManage = await assertEditorOrAdmin(workspaceId, auth.user.id);
    if (!canManage) {
      return NextResponse.json({ error: "Only workspace admins can create ingest tokens" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      scopes?: string[];
      environment?: string | null;
      expiresAt?: string | null;
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { token, rawToken } = await createIngestToken({
      workspaceId,
      name: body.name.trim(),
      scopes: body.scopes,
      environment: body.environment ?? null,
      expiresAt: body.expiresAt ?? null,
      createdBy: auth.user.id,
    });

    // rawToken returned ONCE — never log or store
    return NextResponse.json({ ...token, rawToken }, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create ingest token");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
