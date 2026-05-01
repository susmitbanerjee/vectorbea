import { NextRequest, NextResponse } from "next/server";

import type { ReliabilityRiskLevel } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createRegressionCase, listRegressionCases } from "@/lib/server/workflow-regressions";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ suiteId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { suiteId } = await params;
    const cases = await listRegressionCases(workspaceId, suiteId);
    return NextResponse.json(cases);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load regression cases");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

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
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string | null;
      inputPayload?: Record<string, unknown>;
      expectedToolSequence?: string[];
      forbiddenTools?: string[];
      requiredTools?: string[];
      expectedOutcome?: string | null;
      expectedFinalAction?: string | null;
      rules?: Record<string, unknown>;
      tags?: string[];
      riskLevel?: ReliabilityRiskLevel;
      sourceTraceId?: string | null;
    };
    if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    const item = await createRegressionCase({
      workspaceId,
      suiteId,
      name: body.name.trim(),
      description: body.description ?? null,
      inputPayload: body.inputPayload ?? {},
      expectedToolSequence: body.expectedToolSequence ?? [],
      forbiddenTools: body.forbiddenTools ?? [],
      requiredTools: body.requiredTools ?? [],
      expectedOutcome: body.expectedOutcome ?? null,
      expectedFinalAction: body.expectedFinalAction ?? null,
      rules: body.rules ?? {},
      tags: body.tags ?? [],
      riskLevel: body.riskLevel ?? "medium",
      sourceTraceId: body.sourceTraceId ?? null,
      createdBy: auth.user.id,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create regression case");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
