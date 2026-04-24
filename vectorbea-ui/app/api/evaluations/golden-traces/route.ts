import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { listGoldenTraces, markGoldenTrace } from "@/lib/server/golden-traces";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    return NextResponse.json(await listGoldenTraces(workspaceId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load golden traces");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const body = await request.json().catch(() => ({})) as { traceId?: string; promptName?: string; promptVersion?: string; label?: string; notes?: string };
    if (!body.traceId) return NextResponse.json({ error: "traceId required" }, { status: 400 });
    const result = await markGoldenTrace({ workspaceId, traceId: body.traceId, promptName: body.promptName, promptVersion: body.promptVersion, label: body.label, notes: body.notes, createdBy: auth.user.id });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to mark golden trace");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
