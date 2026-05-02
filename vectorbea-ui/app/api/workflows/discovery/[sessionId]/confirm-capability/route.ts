import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { confirmDiscoveredCapability } from "@/lib/server/workflow-discovery";
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
      discoveredCapabilityId?: string;
      mergeIntoCapabilityId?: string | null;
    };
    if (!body.discoveredCapabilityId?.trim()) {
      return NextResponse.json({ error: "discoveredCapabilityId is required" }, { status: 400 });
    }

    const { sessionId } = await params;
    const result = await confirmDiscoveredCapability({
      workspaceId,
      sessionId,
      discoveredCapabilityId: body.discoveredCapabilityId.trim(),
      mergeIntoCapabilityId: body.mergeIntoCapabilityId?.trim() || null,
      userId: auth.user.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to confirm discovered capability");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
