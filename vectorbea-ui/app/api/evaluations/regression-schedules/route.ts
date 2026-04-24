import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { listRegressionSchedules, createRegressionSchedule } from "@/lib/server/regression-schedules";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "scheduled_regressions");
    return NextResponse.json(await listRegressionSchedules(workspaceId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load regression schedules");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "scheduled_regressions");
    const body = await request.json().catch(() => ({})) as { name?: string; baselineDatasetId?: string; candidatePromptVersionStrategy?: string; candidatePromptVersionId?: string; promptName?: string; cronExpression?: string };
    if (!body.name || !body.baselineDatasetId) {
      return NextResponse.json({ error: "name and baselineDatasetId are required" }, { status: 400 });
    }
    const schedule = await createRegressionSchedule({
      workspaceId,
      name: body.name,
      baselineDatasetId: body.baselineDatasetId,
      candidatePromptVersionStrategy: (body.candidatePromptVersionStrategy as "latest_published" | "specific_version") ?? "latest_published",
      candidatePromptVersionId: body.candidatePromptVersionId,
      promptName: body.promptName,
      cronExpression: body.cronExpression,
      createdBy: auth.user.id,
    });
    return NextResponse.json(schedule, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create regression schedule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
