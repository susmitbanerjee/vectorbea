import { after, NextRequest, NextResponse } from "next/server";

import type { ProviderArenaCandidateInput } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { listProviderArenaRuns, processProviderArenaRun, startProviderArenaRun } from "@/lib/server/behavioral-evaluation-runs";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { assertUsageAvailable } from "@/lib/server/usage-quotas";
import { listBehavioralItems } from "@/lib/server/behavioral-datasets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const runs = await listProviderArenaRuns(workspaceId);
    return NextResponse.json(runs);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load provider arena runs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const rate = consumeRateLimit(`provider-arena:${workspaceId}:${auth.user.id}`, 5, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded for provider arena creation." }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      datasetId?: string;
      rubricId?: string;
      promptVersionId?: string;
      runName?: string;
      candidates?: ProviderArenaCandidateInput[];
    };
    const promptVersionId = body.promptVersionId?.trim();
    if (
      !body.datasetId?.trim() ||
      !body.rubricId?.trim() ||
      !promptVersionId ||
      promptVersionId === "undefined" ||
      promptVersionId === "null" ||
      !Array.isArray(body.candidates) ||
      body.candidates.length === 0
    ) {
      return NextResponse.json({ error: "datasetId, rubricId, promptVersionId and candidates are required" }, { status: 400 });
    }

    const datasetItems = await listBehavioralItems(body.datasetId.trim());
    const providerExecutions = Math.max(1, body.candidates.length * datasetItems.length);
    await assertUsageAvailable(workspaceId, {
      provider_arena_runs: 1,
      evaluation_executions: providerExecutions,
      provider_executions: providerExecutions,
      judge_executions: providerExecutions,
    });

    const run = await startProviderArenaRun({
      workspaceId,
      datasetId: body.datasetId.trim(),
      rubricId: body.rubricId.trim(),
      promptVersionId,
      runName: body.runName?.trim() || undefined,
      candidates: body.candidates,
      startedBy: auth.user.id,
    });
    after(async () => {
      try {
        await processProviderArenaRun({
          workspaceId,
          runId: run.id,
          startedBy: auth.user.id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider Arena run failed";
        console.warn("[provider-arena] background run failed:", message);
      }
    });
    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to start provider arena run");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
