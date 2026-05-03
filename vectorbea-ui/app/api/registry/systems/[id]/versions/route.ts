import { NextRequest, NextResponse } from "next/server";

import type { CapabilityVersionStatus } from "@/lib/api";
import { assertWorkspaceMember, requireWorkspaceRole } from "@/lib/server/assert-workspace-member";
import { createVersion, listVersions } from "@/lib/server/ai-capabilities";
import { writeAuditEvent } from "@/lib/server/governance";
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
    const roleError = requireWorkspaceRole(auth.user.role, "editor", "Viewers cannot create AI system versions.");
    if (roleError) return roleError;
    const { id } = await params;
    return NextResponse.json(await listVersions(workspaceId, id));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load versions");
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
      versionNumber?: string;
      name?: string | null;
      description?: string | null;
      baseVersionId?: string | null;
      status?: CapabilityVersionStatus;
      config?: Record<string, unknown>;
    };

    const version = await createVersion({
      workspaceId,
      capabilityId: id,
      versionNumber: body.versionNumber?.trim(),
      name: body.name ?? null,
      description: body.description ?? null,
      baseVersionId: body.baseVersionId ?? null,
      status: body.status ?? "draft",
      config: body.config ?? {},
      createdBy: auth.user.id,
    });

    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType: "capability_version_created",
      entityType: "capability_version",
      entityId: version.id,
      entityName: version.versionNumber,
      metadata: { capability_id: id, status: version.status },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create version");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
