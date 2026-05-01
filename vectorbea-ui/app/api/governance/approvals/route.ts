import { NextRequest, NextResponse } from "next/server";

import type { ApprovalRequestType } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { createApprovalRequest, listApprovalRequests } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "approval_workflows");
    const status = request.nextUrl.searchParams.get("status")?.trim() || undefined;
    const capabilityId = request.nextUrl.searchParams.get("capabilityId")?.trim() || undefined;
    return NextResponse.json(await listApprovalRequests(workspaceId, { status, capabilityId }));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load approvals");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "approval_workflows");
    const body = (await request.json().catch(() => ({}))) as {
      capabilityId?: string | null;
      capabilityVersionId?: string | null;
      requestType?: ApprovalRequestType;
      requiredApprovals?: number;
      reason?: string | null;
    };
    if (!body.requestType) return NextResponse.json({ error: "requestType is required" }, { status: 400 });
    return NextResponse.json(await createApprovalRequest({
      workspaceId,
      capabilityId: body.capabilityId ?? null,
      capabilityVersionId: body.capabilityVersionId ?? null,
      requestType: body.requestType,
      requestedBy: auth.user.id,
      requiredApprovals: body.requiredApprovals,
      reason: body.reason ?? null,
    }), { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create approval request");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
