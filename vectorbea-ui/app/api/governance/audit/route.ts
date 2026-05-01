import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { listAuditEvents } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "governance_dashboard");
    const eventType = request.nextUrl.searchParams.get("eventType")?.trim() || undefined;
    const entityType = request.nextUrl.searchParams.get("entityType")?.trim() || undefined;
    return NextResponse.json(await listAuditEvents(workspaceId, { eventType, entityType }));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load audit events");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
