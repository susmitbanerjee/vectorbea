import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { deleteRegressionSchedule, toggleRegressionSchedule, updateRegressionSchedule } from "@/lib/server/regression-schedules";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "scheduled_regressions");
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as {
      enabled?: boolean;
      name?: string;
      baselineDatasetId?: string | null;
      candidatePromptVersionStrategy?: "latest_published" | "specific_version";
      candidatePromptVersionId?: string | null;
      promptName?: string | null;
      cronExpression?: string | null;
      providerType?: string | null;
      providerModel?: string | null;
    };
    if (typeof body.enabled === "boolean") {
      return NextResponse.json(await toggleRegressionSchedule(workspaceId, id, body.enabled));
    }
    return NextResponse.json(await updateRegressionSchedule({
      workspaceId,
      id,
      patch: {
        name: body.name,
        baselineDatasetId: body.baselineDatasetId,
        candidatePromptVersionStrategy: body.candidatePromptVersionStrategy,
        candidatePromptVersionId: body.candidatePromptVersionId,
        promptName: body.promptName,
        cronExpression: body.cronExpression,
        providerType: body.providerType,
        providerModel: body.providerModel,
      },
    }));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update regression schedule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "scheduled_regressions");
    const { id } = await params;
    await deleteRegressionSchedule(workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to delete regression schedule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
