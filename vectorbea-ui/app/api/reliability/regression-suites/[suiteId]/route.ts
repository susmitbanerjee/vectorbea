import { NextRequest, NextResponse } from "next/server";

import type { RegressionSuiteType } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getRegressionSuite, updateRegressionSuite } from "@/lib/server/workflow-regressions";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ suiteId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { suiteId } = await params;
    const suite = await getRegressionSuite(workspaceId, suiteId);
    if (!suite) return NextResponse.json({ error: "Regression suite not found" }, { status: 404 });
    return NextResponse.json(suite);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load regression suite");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ suiteId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { suiteId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string | null;
      suiteType?: RegressionSuiteType;
      enabled?: boolean;
      archivedAt?: string | null;
    };
    const suite = await updateRegressionSuite({
      workspaceId,
      suiteId,
      patch: {
        name: body.name,
        description: body.description,
        suiteType: body.suiteType,
        enabled: body.enabled,
        archivedAt: body.archivedAt,
      },
    });
    return NextResponse.json(suite);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update regression suite");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
