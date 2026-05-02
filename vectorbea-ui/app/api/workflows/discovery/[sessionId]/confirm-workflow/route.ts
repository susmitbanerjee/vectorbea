import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { confirmDiscoveredWorkflow } from "@/lib/server/workflow-discovery";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const body = (await request.json().catch(() => ({}))) as { discoveredWorkflowId?: string };
    if (!body.discoveredWorkflowId?.trim()) {
      return NextResponse.json({ error: "discoveredWorkflowId is required" }, { status: 400 });
    }

    const { sessionId } = await params;
    const result = await confirmDiscoveredWorkflow({
      workspaceId,
      sessionId,
      discoveredWorkflowId: body.discoveredWorkflowId.trim(),
      userId: auth.user.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to confirm discovered workflow");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
