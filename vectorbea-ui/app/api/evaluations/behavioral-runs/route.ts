import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { startBehavioralRubricRun, listBehavioralRuns } from "@/lib/server/behavioral-evaluation-runs";
import { assertUsageAvailable } from "@/lib/server/usage-quotas";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { listBehavioralItems } from "@/lib/server/behavioral-datasets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const promptVersionId = request.nextUrl.searchParams.get("promptVersionId")?.trim() ?? null;
    const datasetId = request.nextUrl.searchParams.get("datasetId")?.trim() ?? null;
    const provider = request.nextUrl.searchParams.get("provider")?.trim() ?? null;
    const status = request.nextUrl.searchParams.get("status")?.trim() ?? null;
    const dateFrom = request.nextUrl.searchParams.get("dateFrom")?.trim() ?? null;
    const dateTo = request.nextUrl.searchParams.get("dateTo")?.trim() ?? null;
    const runs = await listBehavioralRuns(workspaceId);
    const filtered = runs.filter((run) => {
      if (promptVersionId && run.promptVersionId !== promptVersionId) return false;
      if (datasetId && run.datasetId !== datasetId) return false;
      if (provider && run.provider !== provider) return false;
      if (status && run.status !== status) return false;
      if (dateFrom && new Date(run.createdAt) < new Date(dateFrom)) return false;
      if (dateTo && new Date(run.createdAt) > new Date(dateTo)) return false;
      return true;
    });
    return NextResponse.json(filtered);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load behavioral evaluation runs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const rate = consumeRateLimit(`behavioral-runs:${workspaceId}:${auth.user.id}`, 10, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded for behavioral evaluation creation." }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      datasetId?: string;
      rubricId?: string;
      promptVersionId?: string;
      provider?: string;
      model?: string;
      runName?: string;
    };

    const promptVersionId = body.promptVersionId?.trim();
    if (
      !body.datasetId?.trim() ||
      !body.rubricId?.trim() ||
      !promptVersionId ||
      promptVersionId === "undefined" ||
      promptVersionId === "null" ||
      !body.provider?.trim()
    ) {
      return NextResponse.json(
        { error: "datasetId, rubricId, promptVersionId and provider are required" },
        { status: 400 },
      );
    }
    const datasetItems = await listBehavioralItems(body.datasetId.trim());
    const estimatedExecutions = Math.max(datasetItems.length, 1);
    await assertUsageAvailable(workspaceId, {
      evaluation_executions: estimatedExecutions,
      provider_executions: estimatedExecutions,
      judge_executions: estimatedExecutions,
    });

    const run = await startBehavioralRubricRun({
      workspaceId,
      datasetId: body.datasetId.trim(),
      rubricId: body.rubricId.trim(),
      promptVersionId,
      provider: body.provider.trim(),
      model: body.model?.trim() || "default",
      runName: body.runName?.trim() || undefined,
      startedBy: auth.user.id,
    });

    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to start behavioral evaluation run");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
