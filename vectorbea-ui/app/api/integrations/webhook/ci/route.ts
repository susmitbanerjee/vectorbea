/**
 * POST /api/integrations/webhook/ci
 *
 * CI/CD webhook endpoint. Receives evidence from GitHub Actions, GitLab CI,
 * Jenkins, or any CI system and creates an evidence_source_event + evidence run.
 */
import { NextRequest, NextResponse } from "next/server";

import { authenticateIngestToken } from "@/lib/server/ingest-tokens";
import { recordEvidenceSourceEvent, resolveAiSystem, upsertDiscoveredAiSystem } from "@/lib/server/integrations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

interface CiEvidencePayload {
  workspace_id?: string;
  ai_system_id?: string;
  ai_system_name?: string;
  version?: string;
  evidence_type?: string;
  status?: "passed" | "failed" | "needs_review";
  test_results?: Record<string, unknown>;
  artifact_url?: string | null;
  commit_sha?: string | null;
  branch?: string | null;
  run_url?: string | null;
  environment?: string | null;
  metadata?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    let workspaceId: string | null = null;
    let tokenAuth: Awaited<ReturnType<typeof authenticateIngestToken>> | null = null;

    try {
      tokenAuth = await authenticateIngestToken(
        request.headers.get("authorization"),
        request.headers.get("x-vectorbea-ingest-token"),
        request.headers.get("x-vectorbea-token"),
      );
      workspaceId = tokenAuth!.workspaceId;
    } catch {
      return NextResponse.json({ error: "Invalid or missing ingest token" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as CiEvidencePayload | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

    if (!body.ai_system_id && !body.ai_system_name) {
      return NextResponse.json({ error: "ai_system_id or ai_system_name is required" }, { status: 400 });
    }
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 });

    // Resolve AI system
    const resolved = await resolveAiSystem(workspaceId, {
      aiSystemId: body.ai_system_id,
      aiSystemName: body.ai_system_name,
    });

    let aiSystemId: string | null = resolved?.id ?? null;

    if (!aiSystemId && body.ai_system_name) {
      const discovered = await upsertDiscoveredAiSystem({
        workspaceId,
        suggestedName: body.ai_system_name,
        sourceType: "ci_cd",
        environment: body.environment ?? null,
      });
      // Still record the event but unassigned
      aiSystemId = discovered.linkedAiSystemId;
    }

    const eventId = await recordEvidenceSourceEvent({
      workspaceId,
      sourceType: "ci_cd",
      aiSystemId,
      eventType: "ci_evidence",
      payload: body as Record<string, unknown>,
      normalizedPayload: {
        ai_system_id: aiSystemId,
        evidence_type: body.evidence_type ?? "workflow_regression",
        status: body.status,
        version: body.version ?? null,
        commit_sha: body.commit_sha ?? null,
        branch: body.branch ?? null,
        run_url: body.run_url ?? null,
        artifact_url: body.artifact_url ?? null,
      },
    });

    return NextResponse.json({ accepted: true, eventId }, { status: 202 });
  } catch (error) {
    console.error("[webhook/ci] Error:", error);
    const safe = toSafeApiError(error, "CI evidence ingest error");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
