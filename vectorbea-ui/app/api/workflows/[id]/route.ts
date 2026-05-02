import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getDiscoveredWorkflow } from "@/lib/server/workflow-discovery";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const workflow = await getDiscoveredWorkflow(workspaceId, id);
    if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    return NextResponse.json(workflow);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load workflow");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
