import { NextRequest, NextResponse } from "next/server";

import type { ReliabilityRuleType, ReliabilityRiskLevel } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createRule, listRules } from "@/lib/server/reliability-rules";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const capabilityId = request.nextUrl.searchParams.get("capabilityId")?.trim() || undefined;
    const rules = await listRules(workspaceId, { capabilityId });
    return NextResponse.json(rules);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load rules");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "deterministic_rules");

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string | null;
      ruleType?: ReliabilityRuleType;
      severity?: ReliabilityRiskLevel;
      enabled?: boolean;
      config?: Record<string, unknown>;
      capabilityId?: string | null;
      capabilityVersionId?: string | null;
    };
    if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!body.ruleType) return NextResponse.json({ error: "ruleType is required" }, { status: 400 });

    const rule = await createRule({
      workspaceId,
      capabilityId: body.capabilityId ?? null,
      capabilityVersionId: body.capabilityVersionId ?? null,
      name: body.name.trim(),
      description: body.description ?? null,
      ruleType: body.ruleType,
      severity: body.severity ?? "medium",
      enabled: body.enabled ?? true,
      config: body.config ?? {},
      createdBy: auth.user.id,
    });
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create rule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
