/**
 * POST /api/integrations/upload
 *
 * Manual evidence upload. Accepts JSON or text file content representing
 * evidence results. Creates evidence_source_event and evidence_run.
 */
import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { recordEvidenceSourceEvent, resolveAiSystem } from "@/lib/server/integrations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const contentType = request.headers.get("content-type") ?? "";
    let payload: Record<string, unknown>;

    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      payload = body;
    } else if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      const file = formData.get("file");
      const aiSystemId = formData.get("ai_system_id") as string | null;
      const evidenceType = formData.get("evidence_type") as string | null;
      const status = formData.get("status") as string | null;

      if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });
      const text = typeof file === "string" ? file : await (file as Blob).text();
      let parsedContent: unknown;
      try { parsedContent = JSON.parse(text); } catch { parsedContent = { raw: text }; }

      payload = {
        ai_system_id: aiSystemId ?? null,
        evidence_type: evidenceType ?? "manual_evidence",
        status: status ?? "needs_review",
        content: parsedContent,
        uploaded_by: auth.user.id,
      };
    } else {
      return NextResponse.json({ error: "Unsupported content type. Use application/json or multipart/form-data" }, { status: 415 });
    }

    const aiSystemId = payload.ai_system_id as string | null ?? null;
    const aiSystemName = payload.ai_system_name as string | null ?? null;
    const resolved = await resolveAiSystem(workspaceId, { aiSystemId, aiSystemName });

    const eventId = await recordEvidenceSourceEvent({
      workspaceId,
      sourceType: "manual_upload",
      aiSystemId: resolved?.id ?? aiSystemId,
      eventType: "manual_evidence",
      payload,
      normalizedPayload: {
        ai_system_id: resolved?.id ?? aiSystemId,
        evidence_type: payload.evidence_type ?? "manual_evidence",
        status: payload.status ?? "needs_review",
        uploaded_by: auth.user.id,
      },
    });

    return NextResponse.json({ accepted: true, eventId, status: "needs_review" }, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Upload failed");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
