import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import {
  createDatasetEvaluationRun,
  createTraceSetEvaluationRun,
  listEvaluationRuns,
} from "@/lib/server/evaluation-runs";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { assertQuotaAvailable } from "@/lib/server/usage-quotas";

export const dynamic = "force-dynamic";
// Allow up to 5 minutes for long-running multi-item evaluations (LLM calls per item)
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json([]);
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "evaluations");

    return NextResponse.json(await listEvaluationRuns(workspaceId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load evaluation runs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "evaluations");
    const rate = consumeRateLimit(`evaluations:trace-sets:${workspaceId}:${auth.user.id}`, 20, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded for evaluation creation." }, { status: 429 });
    }
    await assertQuotaAvailable(workspaceId, "evaluation_runs", 1);

    const body = (await request.json().catch(() => ({}))) as {
      sourceTraceIds?: string[];
      candidatePromptVersionId?: string;
      /** Run against an evaluation_dataset or baseline_dataset */
      datasetId?: string;
      /** Multi-provider: array of { providerType, model } pairs to run in parallel */
      selectedModels?: Array<{ providerType: string; model?: string }>;
    };

    if (!body.candidatePromptVersionId?.trim()) {
      return NextResponse.json(
        { error: "candidatePromptVersionId is required" },
        { status: 400 },
      );
    }

    // Dataset-based run path
    if (body.datasetId?.trim()) {
      return NextResponse.json(
        await createDatasetEvaluationRun({
          workspaceId,
          datasetId: body.datasetId.trim(),
          candidatePromptVersionId: body.candidatePromptVersionId.trim(),
          triggeredBy: auth.user.id,
          selectedModels: body.selectedModels,
        }),
        { status: 201 },
      );
    }

    // Legacy trace-set path
    if (!Array.isArray(body.sourceTraceIds) || body.sourceTraceIds.length === 0) {
      return NextResponse.json(
        { error: "Either datasetId or sourceTraceIds (non-empty) is required" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await createTraceSetEvaluationRun({
        workspaceId,
        sourceTraceIds: body.sourceTraceIds,
        candidatePromptVersionId: body.candidatePromptVersionId.trim(),
        triggeredBy: auth.user.id,
      }),
      { status: 201 },
    );
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create evaluation run");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
