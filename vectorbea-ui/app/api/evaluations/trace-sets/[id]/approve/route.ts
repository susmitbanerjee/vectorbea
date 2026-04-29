import { NextRequest, NextResponse } from "next/server";

import { approveEvaluationRun, getEvaluationRun } from "@/lib/server/evaluation-runs";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const { id } = await params;

    // Pre-fetch so we have prompt info available even if approval is blocked
    const existingRun = await getEvaluationRun(workspaceId, id).catch(() => null);

    let run;
    try {
      run = await approveEvaluationRun({
        workspaceId,
        evaluationRunId: id,
        approvedBy: auth.user.id,
      });
    } catch (approvalError) {
      const msg = approvalError instanceof Error ? approvalError.message : "Promotion blocked";
      if (msg.startsWith("Promotion blocked:")) {
        const reasons = msg.replace("Promotion blocked: ", "").split(/(?<=[.!?])\s+/);
        try {
          let promptId = "";
          if (existingRun?.candidatePromptVersionId) {
            const supabase = createVectorBeaAdminClient();
            const { data: version } = await supabase
              .from("prompt_versions")
              .select("prompt_id")
              .eq("id", existingRun.candidatePromptVersionId)
              .maybeSingle();
            promptId = version?.prompt_id ?? "";
          }
          const { notifyRolloutBlocked } = await import("@/lib/server/notifications");
          await notifyRolloutBlocked({
            workspaceId,
            promptName: existingRun?.promptName ?? "unknown",
            promptId,
            versionTag: existingRun?.candidateVersionTag ?? "",
            reasons,
          });
        } catch { /* non-blocking */ }
      }
      throw approvalError;
    }

    // Await so notification completes before the serverless function exits
    try {
      const { notifyPromptPromoted } = await import("@/lib/server/notifications");
      await notifyPromptPromoted({
        workspaceId,
        promptName: run?.promptName ?? "unknown",
        promptId: run?.candidatePromptVersionId ?? "",
        versionTag: run?.candidateVersionTag ?? "",
        promotedBy: auth.user.id,
      });
    } catch { /* non-blocking */ }

    return NextResponse.json(run);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to approve evaluation run");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
