import { NextRequest, NextResponse } from "next/server";

import type { RegressionSuiteType } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createRegressionSuite, listRegressionSuites } from "@/lib/server/workflow-regressions";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const suites = await listRegressionSuites(workspaceId, id);
    return NextResponse.json(suites);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load regression suites");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string | null;
      suiteType?: RegressionSuiteType;
      enabled?: boolean;
    };
    if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const suite = await createRegressionSuite({
      workspaceId,
      capabilityId: id,
      name: body.name.trim(),
      description: body.description ?? null,
      suiteType: body.suiteType ?? "mixed",
      enabled: body.enabled ?? true,
      createdBy: auth.user.id,
    });
    return NextResponse.json(suite, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create regression suite");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
