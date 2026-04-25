import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

const ALLOWED_STATUSES = ["draft", "candidate", "active", "deprecated", "blocked"] as const;
type LifecycleStatus = (typeof ALLOWED_STATUSES)[number];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id: promptId, versionId } = await params;
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const authResult = await assertWorkspaceMember(request, workspaceId);
  if (authResult.error) return authResult.error;

  try {
    const body = await request.json() as { status: LifecycleStatus };
    if (!ALLOWED_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}` }, { status: 400 });
    }

    const supabase = createVectorBeaAdminClient();

    // Verify the version belongs to the prompt in this workspace
    const { data: prompt } = await supabase
      .from("prompts")
      .select("id")
      .eq("id", promptId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!prompt) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("prompt_versions")
      .update({ lifecycle_status: body.status })
      .eq("id", versionId)
      .eq("prompt_id", promptId)
      .select("id, version_tag, is_published, lifecycle_status, created_at")
      .single();

    if (error) throw new Error(error.message);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
