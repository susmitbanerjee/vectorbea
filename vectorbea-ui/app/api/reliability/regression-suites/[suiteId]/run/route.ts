import { after, NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { processWorkflowRegressionRun, startWorkflowRegressionRun } from "@/lib/server/workflow-regressions";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ suiteId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { suiteId } = await params;
    const body = (await request.json().catch(() => ({}))) as { capabilityVersionId?: string };
    if (!body.capabilityVersionId?.trim()) {
      return NextResponse.json({ error: "capabilityVersionId is required" }, { status: 400 });
    }
    const run = await startWorkflowRegressionRun({
      workspaceId,
      suiteId,
      capabilityVersionId: body.capabilityVersionId.trim(),
      startedBy: auth.user.id,
      triggerSource: "manual",
    });
    if (!run) {
      return NextResponse.json({ error: "Failed to create regression run" }, { status: 500 });
    }
    const runId = run.id;
    after(async () => {
      try {
        await processWorkflowRegressionRun({ workspaceId, runId });
      } catch (error) {
        console.warn("[workflow-regression] async run failed:", error instanceof Error ? error.message : String(error));
      }
    });
    return NextResponse.json(run, { status: 202 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to start regression run");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
