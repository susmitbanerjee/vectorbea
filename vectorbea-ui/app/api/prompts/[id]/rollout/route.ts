import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { getPromptRolloutDistribution, updateVersionRollout } from "@/lib/server/rollout";
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
    const result = await updateVersionRollout({
      workspaceId,
      promptId,
      promptVersionId: body.promptVersionId,
      rolloutStatus: body.rolloutStatus as RolloutStatus,
      rolloutPercentage: body.rolloutPercentage ?? 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
