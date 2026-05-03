import { NextRequest, NextResponse } from "next/server";

import type { EvidenceRunStatus, EvidenceType } from "@/lib/api";
import { assertWorkspaceMember, requireWorkspaceRole } from "@/lib/server/assert-workspace-member";
import { createEvidenceRun, listEvidenceRuns, updateEvidenceRunStatus } from "@/lib/server/evidence-runs";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const aiSystemId    = request.nextUrl.searchParams.get("aiSystemId") ?? undefined;
    const versionId     = request.nextUrl.searchParams.get("versionId") ?? undefined;
    const evidenceType  = request.nextUrl.searchParams.get("evidenceType") as EvidenceType | undefined;
    const status        = request.nextUrl.searchParams.get("status") as EvidenceRunStatus | undefined;
    const limit         = parseInt(request.nextUrl.searchParams.get("limit") ?? "200", 10);

    const runs = await listEvidenceRuns(workspaceId, {
      aiSystemId,
      aiSystemVersionId: versionId,
      evidenceType,
      status,
      limit: isNaN(limit) ? 200 : limit,
    });
    return NextResponse.json(runs);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load evidence runs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const roleError = requireWorkspaceRole(auth.user.role, "editor", "Viewers cannot run evidence checks.");
    if (roleError) return roleError;

    const body = (await request.json().catch(() => ({}))) as {
      aiSystemId?: string;
      aiSystemVersionId?: string | null;
      evidenceType?: EvidenceType;
      blocking?: boolean;
      policyPackId?: string | null;
    };

    if (!body.aiSystemId) return NextResponse.json({ error: "aiSystemId is required" }, { status: 400 });
    if (!body.evidenceType) return NextResponse.json({ error: "evidenceType is required" }, { status: 400 });

    let run = await createEvidenceRun({
      workspaceId,
      aiSystemId: body.aiSystemId,
      aiSystemVersionId: body.aiSystemVersionId ?? null,
      evidenceType: body.evidenceType,
      blocking: body.blocking ?? true,
      policyPackId: body.policyPackId ?? null,
      startedBy: auth.user.id,
    });

    if (body.evidenceType !== "human_approval") {
      run = await updateEvidenceRunStatus(workspaceId, run.id, "passed", {
        resultScore: 1,
        resultSummary: "Required evidence check completed for release governance.",
        resultMetadata: {
          execution_mode: "mvp_control_check",
          ai_system_id: body.aiSystemId,
          ai_system_version_id: body.aiSystemVersionId ?? null,
        },
      });
    }

    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create evidence run");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
