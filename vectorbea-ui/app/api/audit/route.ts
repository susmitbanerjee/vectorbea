import { NextRequest, NextResponse } from "next/server";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import type { AuditLogView } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json([] as AuditLogView[]);
    }

    const supabase = createVectorBeaAdminClient();

    // audit_logs are keyed by organization_id; resolve via workspace first
    const { data: workspace } = await supabase
      .from("workspaces")
      .select("organization_id")
      .eq("id", workspaceId)
      .single();

    if (!workspace?.organization_id) {
      return NextResponse.json([] as AuditLogView[]);
    }

    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, organization_id, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at, prompt_versions(version_tag, prompts(name))")
      .eq("organization_id", workspace.organization_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    const logs: AuditLogView[] = (data ?? []).map((row) => {
      const versionRaw = row.prompt_versions as unknown;
      const version = versionRaw as { version_tag: string; prompts: { name: string } | { name: string }[] | null } | null;
      return {
        timestamp: row.created_at,
        workspaceId,
        promptName: (Array.isArray(version?.prompts) ? version?.prompts[0]?.name : version?.prompts?.name) ?? "",
        versionTag: version?.version_tag ?? "",
        proxyLatencyMs: row.proxy_latency_ms ?? 0,
        llmLatencyMs: row.llm_latency_ms ?? 0,
        tokenCount: row.token_count ?? 0,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      };
    });

    return NextResponse.json(logs);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load audit logs" },
      { status: 500 },
    );
  }
}
