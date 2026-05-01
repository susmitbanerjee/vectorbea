import { NextRequest, NextResponse } from "next/server";

import type { CapabilityVersionStatus } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVersion, listVersions } from "@/lib/server/ai-capabilities";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
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
    const { id } = await params;
    const versions = await listVersions(workspaceId, id);
    return NextResponse.json(versions);
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
    await assertFeatureAccess(workspaceId, "ai_capabilities");
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      versionNumber?: string;
      name?: string | null;
      status?: CapabilityVersionStatus;
      config?: Record<string, unknown>;
      promptVersionId?: string | null;
      skillDefinition?: Record<string, unknown> | null;
      workflowDefinition?: Record<string, unknown> | null;
      providerConfig?: Record<string, unknown> | null;
    };
    if (!body.versionNumber?.trim()) return NextResponse.json({ error: "versionNumber is required" }, { status: 400 });

    const version = await createVersion({
      workspaceId,
      capabilityId: id,
      versionNumber: body.versionNumber.trim(),
      name: body.name ?? null,
      status: body.status ?? "draft",
      config: body.config ?? {},
      promptVersionId: body.promptVersionId ?? null,
      skillDefinition: body.skillDefinition ?? null,
      workflowDefinition: body.workflowDefinition ?? null,
      providerConfig: body.providerConfig ?? null,
      createdBy: auth.user.id,
    });
    return NextResponse.json(version, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create version");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
