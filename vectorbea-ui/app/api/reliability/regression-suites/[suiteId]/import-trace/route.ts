import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { importRegressionCaseFromTrace } from "@/lib/server/workflow-regressions";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ suiteId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { suiteId } = await params;
    const body = (await request.json().catch(() => ({}))) as { traceId?: string };
    if (!body.traceId?.trim()) return NextResponse.json({ error: "traceId is required" }, { status: 400 });
    const item = await importRegressionCaseFromTrace({
      workspaceId,
      suiteId,
      traceId: body.traceId.trim(),
      createdBy: auth.user.id,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to import regression case from trace");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
