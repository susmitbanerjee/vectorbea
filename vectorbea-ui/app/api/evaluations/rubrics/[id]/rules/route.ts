import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { getRubricWithDetails, listRules, createRule } from "@/lib/server/rubrics";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { RubricRuleType, RubricSeverity } from "@/lib/api";

export const dynamic = "force-dynamic";

const VALID_RULE_TYPES: RubricRuleType[] = ["must_do", "must_not_do", "hard_fail"];
const VALID_SEVERITIES: RubricSeverity[] = ["low", "medium", "high", "critical"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rubricId } = await params;
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

    return NextResponse.json(await listRules(rubricId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load rules");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rubricId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    await assertFeatureAccess(workspaceId, "behavioral_evaluations");

    const rubric = await getRubricWithDetails(rubricId);
    if (!rubric || rubric.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Rubric not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({})) as {
      ruleType?: RubricRuleType;
      description?: string;
      severity?: RubricSeverity;
    };

    if (!body.ruleType || !VALID_RULE_TYPES.includes(body.ruleType)) {
      return NextResponse.json({ error: "ruleType must be must_do, must_not_do, or hard_fail" }, { status: 400 });
    }
    if (!body.description?.trim()) {
      return NextResponse.json({ error: "description is required" }, { status: 400 });
    }
    const severity: RubricSeverity = VALID_SEVERITIES.includes(body.severity as RubricSeverity)
      ? (body.severity as RubricSeverity)
      : "medium";

    const rule = await createRule({
      rubricId,
      ruleType: body.ruleType,
      description: body.description,
      severity,
    });

    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create rule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
