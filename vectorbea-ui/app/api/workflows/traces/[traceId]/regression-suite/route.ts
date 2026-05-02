import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createRegressionSuiteFromTrace } from "@/lib/server/workflow-discovery";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ traceId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const body = (await request.json().catch(() => ({}))) as { capabilityId?: string | null };
    const { traceId } = await params;
    const result = await createRegressionSuiteFromTrace({
      workspaceId,
      traceId,
      capabilityId: body.capabilityId?.trim() || null,
      userId: auth.user.id,
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create regression suite from trace");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
