import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { getPromptRolloutDistribution, updateVersionRollout } from "@/lib/server/rollout";
import { evaluateRolloutGate } from "@/lib/server/provider-arena-governance";
import { triggerAutoEvaluation } from "@/lib/server/auto-evaluations";
import type { RolloutStatus } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // Reading rollout state is allowed on all plans — only writing (POST) is gated.
    const { id } = await params;
    return NextResponse.json(await getPromptRolloutDistribution(workspaceId, id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "rollout");
    const { id: promptId } = await params;
    const body = await request.json().catch(() => ({})) as {
      promptVersionId?: string;
      rolloutStatus?: string;
      rolloutPercentage?: number;
    };
    if (!body.promptVersionId || !body.rolloutStatus) {
      return NextResponse.json({ error: "promptVersionId and rolloutStatus are required" }, { status: 400 });
    }
    const shouldGate =
      body.rolloutStatus === "active" ||
      (body.rolloutStatus === "candidate" && (body.rolloutPercentage ?? 0) > 0);
    if (shouldGate) {
      let gate;
      try {
        gate = await evaluateRolloutGate({
          workspaceId,
          promptId,
          promptVersionId: body.promptVersionId,
          checkedBy: auth.user.id,
          targetEnvironment: "production",
        });
      } catch (gateError) {
        return NextResponse.json(
          {
            error: gateError instanceof Error ? gateError.message : "Unable to evaluate rollout safety gate",
            code: "ROLLOUT_GATE_UNAVAILABLE",
          },
          { status: 409 },
        );
      }
      if (gate.status !== "passed") {
        return NextResponse.json(
          {
            error: "Rollout blocked by safety gate",
            code: "ROLLOUT_BLOCKED",
            gate,
          },
          { status: 409 },
        );
      }
    }
    const result = await updateVersionRollout({
      workspaceId,
      promptId,
      promptVersionId: body.promptVersionId,
      rolloutStatus: body.rolloutStatus as RolloutStatus,
      rolloutPercentage: body.rolloutPercentage ?? 0,
    });

    // When a version is first promoted to candidate, trigger auto-evaluation
    // (fire-and-forget — don't block the rollout response)
    if (body.rolloutStatus === "candidate") {
      void triggerAutoEvaluation({
        workspaceId,
        promptId,
        promptVersionId: body.promptVersionId,
        trigger: "candidate_promoted",
        force: false,
        startedBy: auth.user.id,
      }).catch((err: unknown) => {
        console.warn("[rollout] Auto-eval trigger failed:", err instanceof Error ? err.message : err);
      });
    }

    return NextResponse.json({ ...result, autoEvalTriggered: body.rolloutStatus === "candidate" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
