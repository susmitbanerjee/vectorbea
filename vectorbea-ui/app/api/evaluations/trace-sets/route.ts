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
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { assertUsageAvailable } from "@/lib/server/usage-quotas";

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
  let workspaceIdForFailure: string | null = null;
  let candidatePromptVersionIdForFailure: string | null = null;
  let triggeredByForFailure: string | null = null;
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }
    workspaceIdForFailure = workspaceId;

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    triggeredByForFailure = auth.user.id;
    await assertFeatureAccess(workspaceId, "evaluations");
    const rate = consumeRateLimit(`evaluations:trace-sets:${workspaceId}:${auth.user.id}`, 20, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded for evaluation creation." }, { status: 429 });
    }
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
    candidatePromptVersionIdForFailure = body.candidatePromptVersionId.trim();

    // Dataset-based run path
    if (body.datasetId?.trim()) {
      const supabase = createVectorBeaAdminClient();
      const { count } = await supabase
        .from("evaluation_dataset_items")
        .select("id", { count: "exact", head: true })
        .eq("dataset_id", body.datasetId.trim())
        .eq("workspace_id", workspaceId);
      await assertUsageAvailable(workspaceId, {
        evaluation_executions: Math.max(count ?? 0, 1),
      });
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
    await assertUsageAvailable(workspaceId, {
      evaluation_executions: Math.max(body.sourceTraceIds.length, 1),
    });

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
    if (workspaceIdForFailure && candidatePromptVersionIdForFailure) {
      try {
        const supabase = createVectorBeaAdminClient();
        const { data: version } = await supabase
          .from("prompt_versions")
          .select("version_tag, prompts(name)")
          .eq("id", candidatePromptVersionIdForFailure)
          .maybeSingle();
        const promptsData = (version as { prompts?: { name?: string } | Array<{ name?: string }> } | null)?.prompts;
        const promptName =
          (promptsData &&
            (Array.isArray(promptsData) ? promptsData[0]?.name : promptsData.name)) ||
          "unknown-prompt";
        const versionTag = version?.version_tag ?? "unknown-version";
        const { notifyEvaluationFailed } = await import("@/lib/server/notifications");
        await notifyEvaluationFailed({
          workspaceId: workspaceIdForFailure,
          promptName,
          versionTag,
          reason: error instanceof Error ? error.message : "Evaluation run failed",
          runType: "trace_set",
          startedBy: triggeredByForFailure,
        });
      } catch {
        // Notification failures must never fail the API error response path
      }
    }
    const safe = toSafeApiError(error, "Failed to create evaluation run");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
