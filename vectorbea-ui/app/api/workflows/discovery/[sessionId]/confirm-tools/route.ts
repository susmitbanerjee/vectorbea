import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { confirmDiscoveredTools } from "@/lib/server/workflow-discovery";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const body = (await request.json().catch(() => ({}))) as {
      toolIds?: string[];
      renameMap?: Record<string, string>;
      mergeMap?: Record<string, string>;
    };
    if (!Array.isArray(body.toolIds) || body.toolIds.length === 0) {
      return NextResponse.json({ error: "toolIds is required" }, { status: 400 });
    }

    const { sessionId } = await params;
    const result = await confirmDiscoveredTools({
      workspaceId,
      sessionId,
      toolIds: body.toolIds.map((value) => String(value)).filter(Boolean),
      renameMap: body.renameMap,
      mergeMap: body.mergeMap,
      userId: auth.user.id,
    });
    return NextResponse.json({ items: result });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to confirm discovered tools");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
