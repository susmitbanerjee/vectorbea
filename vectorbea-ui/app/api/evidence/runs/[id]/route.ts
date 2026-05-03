import { NextRequest, NextResponse } from "next/server";

import type { EvidenceRunStatus } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getEvidenceRun, updateEvidenceRunStatus } from "@/lib/server/evidence-runs";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

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
    const run = await getEvidenceRun(workspaceId, id);
    if (!run) return NextResponse.json({ error: "Evidence run not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load evidence run");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(
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
      status?: EvidenceRunStatus;
      resultScore?: number | null;
      resultSummary?: string | null;
      failureReason?: string | null;
    };
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 });
    const updated = await updateEvidenceRunStatus(workspaceId, id, body.status, {
      resultScore: body.resultScore,
      resultSummary: body.resultSummary,
      failureReason: body.failureReason,
    });
    return NextResponse.json(updated);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update evidence run");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
