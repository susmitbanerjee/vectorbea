import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { listBaselineDatasets, createBaselineDataset } from "@/lib/server/baseline-datasets";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    return NextResponse.json(await listBaselineDatasets(workspaceId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({})) as { name?: string; description?: string; sourceType?: string; traceIds?: string[]; promptName?: string };
    if (!body.name || !Array.isArray(body.traceIds) || body.traceIds.length === 0) {
      return NextResponse.json({ error: "name and traceIds are required" }, { status: 400 });
    }
    const dataset = await createBaselineDataset({
      workspaceId,
      name: body.name,
      description: body.description,
      sourceType: (body.sourceType as "trace_set" | "golden_traces" | "manual") ?? "trace_set",
      traceIds: body.traceIds,
      promptName: body.promptName,
      createdBy: auth.user.id,
    });
    return NextResponse.json(dataset, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
