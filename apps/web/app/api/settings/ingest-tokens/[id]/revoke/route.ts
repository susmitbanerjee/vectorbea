import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { revokeIngestToken } from "@/lib/server/ingest-tokens";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const supabase = createVectorBeaAdminClient();
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (membership?.role !== "admin") {
      return NextResponse.json({ error: "Only workspace admins can revoke ingest tokens" }, { status: 403 });
    }

    const { id } = await params;
    const token = await revokeIngestToken({
      workspaceId,
      tokenId: id,
      revokedBy: auth.user.id,
    });

    return NextResponse.json(token);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to revoke ingest token");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
