import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createInvitation, listInvitations, revokeInvitation } from "@/lib/server/invitations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await assertWorkspaceMember(request, id);
    if (auth.error) return auth.error;
    const invitations = await listInvitations(id);
    return NextResponse.json(invitations);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to list invitations");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await assertWorkspaceMember(request, id);
    if (auth.error) return auth.error;

    const body = await request.json() as { email?: string; role?: string };
    if (!body.email) return NextResponse.json({ error: "email required" }, { status: 400 });
    const role = (body.role ?? "editor") as "admin" | "editor" | "viewer";

    // Get workspace name for email
    const { createVectorBeaAdminClient } = await import("@/lib/supabase-admin");
    const supabase = createVectorBeaAdminClient();
    const { data: ws } = await supabase.from("workspaces").select("name").eq("id", id).maybeSingle();
    const workspaceName = ws?.name ?? id;

    // Get inviter name
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", auth.user.id)
      .maybeSingle();
    const inviterName = profile?.full_name ?? profile?.email ?? auth.user.id;

    const { invitation } = await createInvitation({
      workspaceId: id,
      email: body.email,
      role,
      invitedBy: auth.user.id,
      inviterName,
      workspaceName,
    });
    return NextResponse.json(invitation, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create invitation");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await assertWorkspaceMember(request, id);
    if (auth.error) return auth.error;
    const { searchParams } = new URL(request.url);
    const invitationId = searchParams.get("invitationId");
    if (!invitationId) return NextResponse.json({ error: "invitationId required" }, { status: 400 });
    await revokeInvitation(id, invitationId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to revoke invitation");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
