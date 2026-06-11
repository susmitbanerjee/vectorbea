import { NextRequest, NextResponse } from "next/server";

import type { RedactionRule } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { createRedactionRule, listRedactionRules } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "privacy_controls");
    return NextResponse.json(await listRedactionRules(workspaceId));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load redaction rules");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "privacy_controls");
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      ruleType?: RedactionRule["ruleType"];
      pattern?: string;
      replacement?: string;
      enabled?: boolean;
      scope?: RedactionRule["scope"];
    };
    if (!body.name?.trim() || !body.ruleType || !body.pattern?.trim() || !body.scope) {
      return NextResponse.json({ error: "name, ruleType, pattern, and scope are required" }, { status: 400 });
    }
    return NextResponse.json(await createRedactionRule({
      workspaceId,
      actorUserId: auth.user.id,
      name: body.name.trim(),
      ruleType: body.ruleType,
      pattern: body.pattern.trim(),
      replacement: body.replacement,
      enabled: body.enabled,
      scope: body.scope,
    }), { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create redaction rule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
