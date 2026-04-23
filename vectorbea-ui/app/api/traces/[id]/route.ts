import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { isRuntimeTraceRow, mapAuditRowToTraceDetail, type AuditLogTraceRow } from "@/lib/server/traces";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("audit_logs")
      .select(
        "id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at",
      )
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (!data) {
      return NextResponse.json({ error: "Trace not found" }, { status: 404 });
    }

    const traceRow = data as AuditLogTraceRow;
    if (!isRuntimeTraceRow(traceRow)) {
      return NextResponse.json({ error: "This audit row is not a runtime execution trace." }, { status: 404 });
    }
    let promptTemplateText: string | null = null;
    let promptParameters: Record<string, unknown> | null = null;
    let promptName: string | null = traceRow.prompt_name;
    let promptVersionTag: string | null = traceRow.version_tag;

    if (traceRow.prompt_version_id) {
      const { data: promptVersion } = await supabase
        .from("prompt_versions")
        .select("template_text, parameters, version_tag, prompts(name)")
        .eq("id", traceRow.prompt_version_id)
        .maybeSingle();

      if (promptVersion) {
        promptTemplateText = promptVersion.template_text ?? null;
        promptParameters = (promptVersion.parameters as Record<string, unknown> | null) ?? null;
        promptVersionTag = promptVersion.version_tag ?? promptVersionTag;
        const promptRow = Array.isArray(promptVersion.prompts)
          ? promptVersion.prompts[0]
          : promptVersion.prompts;
        promptName = (promptRow as { name?: string } | null)?.name ?? promptName;
      }
    }

    const normalizedMetadata = normalizeTraceMetadataV1((traceRow.metadata ?? {}) as Record<string, unknown>);
    const custom = (normalizedMetadata.custom ?? {}) as Record<string, unknown>;
    const agentId = typeof custom.agent_id === "string" ? custom.agent_id : null;
    let sidecarName: string | null = null;
    if (agentId) {
      const { data: agent } = await supabase
        .from("deployment_agents")
        .select("name")
        .eq("workspace_id", workspaceId)
        .eq("id", agentId)
        .maybeSingle();
      sidecarName = agent?.name ?? null;
    }

    return NextResponse.json(
      mapAuditRowToTraceDetail(traceRow, {
        promptTemplateText,
        promptParameters,
        promptName,
        promptVersionTag,
        sidecarName,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load trace" },
      { status: 500 },
    );
  }
}
