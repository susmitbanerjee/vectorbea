import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { submitApprovalDecision } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "approval_workflows");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { decision?: "approved" | "rejected"; comment?: string | null };
    if (!body.decision) return NextResponse.json({ error: "decision is required" }, { status: 400 });
    return NextResponse.json(await submitApprovalDecision({
      workspaceId,
      approvalRequestId: id,
      reviewerUserId: auth.user.id,
      decision: body.decision,
      comment: body.comment ?? null,
    }), { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to submit approval decision");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
