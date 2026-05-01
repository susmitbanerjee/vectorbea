import { NextRequest, NextResponse } from "next/server";

import type { CapabilityVersionStatus } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getVersion, updateVersionStatus } from "@/lib/server/ai-capabilities";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { versionId } = await params;
    const version = await getVersion(workspaceId, versionId);
    if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    return NextResponse.json(version);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load version");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "ai_capabilities");
    const { versionId } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: CapabilityVersionStatus };
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 });
    const version = await updateVersionStatus(workspaceId, versionId, body.status);
    return NextResponse.json(version);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update version");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
