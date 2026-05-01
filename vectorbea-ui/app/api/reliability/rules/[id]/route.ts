import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getRule, updateRule, deleteRule } from "@/lib/server/reliability-rules";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const rule = await getRule(workspaceId, id);
    if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    return NextResponse.json(rule);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load rule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "deterministic_rules");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const rule = await updateRule(workspaceId, id, {
      name: body.name as string | undefined,
      description: body.description as string | null | undefined,
      severity: body.severity as "low" | "medium" | "high" | "critical" | undefined,
      enabled: body.enabled as boolean | undefined,
      config: body.config as Record<string, unknown> | undefined,
    });
    return NextResponse.json(rule);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update rule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "deterministic_rules");
    const { id } = await params;
    await deleteRule(workspaceId, id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to delete rule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
