import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { getRubricWithDetails, updateRule, deleteRule } from "@/lib/server/rubrics";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { RubricRuleType, RubricSeverity } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
) {
  try {
    const { id: rubricId, ruleId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const rubric = await getRubricWithDetails(rubricId);
    if (!rubric || rubric.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Rubric not found" }, { status: 404 });
    }
    if (rubric.isLocked) {
      return NextResponse.json(
        { error: "Rubric is locked. Enterprise admin must unlock before editing rules." },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({})) as {
      ruleType?: RubricRuleType;
      description?: string;
      severity?: RubricSeverity;
    };

    const rule = await updateRule(ruleId, body);
    return NextResponse.json(rule);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update rule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ruleId: string }> },
) {
  try {
    const { id: rubricId, ruleId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const rubric = await getRubricWithDetails(rubricId);
    if (!rubric || rubric.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Rubric not found" }, { status: 404 });
    }
    if (rubric.isLocked) {
      return NextResponse.json(
        { error: "Rubric is locked. Enterprise admin must unlock before deleting rules." },
        { status: 403 },
      );
    }

    await deleteRule(ruleId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to delete rule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
