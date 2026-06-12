import { NextRequest, NextResponse } from "next/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";

async function requireAdmin(request: NextRequest, workspaceId: string) {
  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return { error: authResult.error, user: null };
  const supabase = createVectorBeaAdminClient();
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", authResult.user.id)
    .maybeSingle();
  if (!membership || membership.role !== "admin") {
    return { error: NextResponse.json({ error: "Admin role required." }, { status: 403 }), user: null };
  }
  return { error: null, user: authResult.user };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  const { error } = await requireAdmin(request, workspaceId);
  if (error) return error;
  try {
    const supabase = createVectorBeaAdminClient();
    const body = await request.json() as { enabled?: boolean; defaultModel?: string; displayName?: string; baseUrl?: string };
    const { data, error: dbError } = await supabase
      .from("provider_configs")
      .update({
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.defaultModel !== undefined && { default_model: body.defaultModel }),
        ...(body.displayName && { display_name: body.displayName }),
        ...(body.baseUrl !== undefined && { base_url: body.baseUrl }),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .select("id, workspace_id, provider_type, display_name, enabled, default_model, base_url, masked_key, created_at, updated_at")
      .single();
    if (dbError) throw new Error(dbError.message);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  const { error } = await requireAdmin(request, workspaceId);
  if (error) return error;
  try {
    const supabase = createVectorBeaAdminClient();
    const { error: dbError } = await supabase.from("provider_configs").delete().eq("workspace_id", workspaceId).eq("id", id);
    if (dbError) throw new Error(dbError.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
