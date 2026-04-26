import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getPolicy, upsertPolicy } from "@/lib/server/release-policies";

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
    const { id: promptId } = await params;
    return NextResponse.json(await getPolicy(workspaceId, promptId));
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
    const { id: promptId } = await params;
    const body = await request.json().catch(() => ({})) as {
      minScore?: number | null;
      requireCriticalPass?: boolean;
      maxRegressionCount?: number | null;
      blockOnAnyFailure?: boolean;
      requireJsonValid?: boolean;
      requireNoSafetyFailures?: boolean;
      maxLatencyIncreasePct?: number | null;
      maxCostIncreasePct?: number | null;
    };
    return NextResponse.json(
      await upsertPolicy({ workspaceId, promptId, ...body }),
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
