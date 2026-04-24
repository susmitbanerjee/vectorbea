import { NextRequest, NextResponse } from "next/server";
import { reviewEvaluationRun } from "@/lib/server/evaluation-runs";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

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
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      status?: string;
      decision?: string;
      note?: string | null;
    };
    if (!body.status || !body.decision) {
      return NextResponse.json({ error: "status and decision are required" }, { status: 400 });
    }
    const run = await reviewEvaluationRun({
      workspaceId,
      evaluationRunId: id,
      reviewerId: auth.user.id,
      status: body.status as Parameters<typeof reviewEvaluationRun>[0]["status"],
      decision: body.decision as Parameters<typeof reviewEvaluationRun>[0]["decision"],
      note: body.note ?? null,
    });
    return NextResponse.json(run);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update review");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
