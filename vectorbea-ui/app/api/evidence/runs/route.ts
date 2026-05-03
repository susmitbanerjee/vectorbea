import { NextRequest, NextResponse } from "next/server";

import type { EvidenceRunStatus, EvidenceType } from "@/lib/api";
import { assertWorkspaceMember, requireWorkspaceRole } from "@/lib/server/assert-workspace-member";
import { createEvidenceRun, createValidatedEvidenceRun, listEvidenceRuns } from "@/lib/server/evidence-runs";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const aiSystemId    = request.nextUrl.searchParams.get("aiSystemId") ?? undefined;
    const versionId     = request.nextUrl.searchParams.get("versionId") ?? undefined;
    const evidenceType  = request.nextUrl.searchParams.get("evidenceType") as EvidenceType | undefined;
    const status        = request.nextUrl.searchParams.get("status") as EvidenceRunStatus | undefined;
    const limit         = parseInt(request.nextUrl.searchParams.get("limit") ?? "200", 10);

    const runs = await listEvidenceRuns(workspaceId, {
      aiSystemId,
      aiSystemVersionId: versionId,
      evidenceType,
      status,
      limit: isNaN(limit) ? 200 : limit,
    });
    return NextResponse.json(runs);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load evidence runs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const roleError = requireWorkspaceRole(auth.user.role, "editor", "Viewers cannot run evidence checks.");
    if (roleError) return roleError;

    const body = (await request.json().catch(() => ({}))) as {
      aiSystemId?: string;
      aiSystemVersionId?: string | null;
      evidenceType?: EvidenceType;
      blocking?: boolean;
      policyPackId?: string | null;
      sourceType?: string;
      sourceId?: string | null;
      validatorType?: string | null;
      inputPayload?: Record<string, unknown> | null;
      outputPayload?: Record<string, unknown> | null;
      validatorConfig?: Record<string, unknown> | null;
    };

    if (!body.aiSystemId) return NextResponse.json({ error: "aiSystemId is required" }, { status: 400 });
    if (!body.evidenceType) return NextResponse.json({ error: "evidenceType is required" }, { status: 400 });

    if (body.evidenceType !== "human_approval" && !body.sourceType && !body.sourceId && !body.inputPayload && !body.outputPayload) {
      return NextResponse.json(
        {
          error:
            "Missing evidence source. Provide sourceType plus real input/output payload or a source reference from CI, SDK, sidecar, OpenTelemetry, RAG, MCP, workflow, prompt, or provider test evidence.",
        },
        { status: 400 },
      );
    }

    const run = body.evidenceType === "human_approval" ? await createEvidenceRun({
      workspaceId,
      aiSystemId: body.aiSystemId,
      aiSystemVersionId: body.aiSystemVersionId ?? null,
      evidenceType: body.evidenceType,
      blocking: body.blocking ?? true,
      policyPackId: body.policyPackId ?? null,
      startedBy: auth.user.id,
    }) : await createValidatedEvidenceRun({
      workspaceId,
      aiSystemId: body.aiSystemId,
      aiSystemVersionId: body.aiSystemVersionId ?? null,
      evidenceType: body.evidenceType,
      blocking: body.blocking ?? true,
      policyPackId: body.policyPackId ?? null,
      sourceType: body.sourceType ?? "direct_api",
      sourceId: body.sourceId ?? null,
      validatorType: body.validatorType ?? null,
      inputPayload: body.inputPayload ?? null,
      outputPayload: body.outputPayload ?? null,
      validatorConfig: body.validatorConfig ?? null,
      startedBy: auth.user.id,
    });

    return NextResponse.json(run, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create evidence run");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
