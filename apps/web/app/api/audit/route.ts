import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { resolveAuditLlmLatencyMs, resolveAuditProxyLatencyMs } from "@/lib/server/audit-latency";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { AuditLogView } from "@/lib/api";

export const dynamic = "force-dynamic";

function resolveUseType(metadata: Record<string, unknown>): "runtime" | "audit" {
  const normalized = normalizeTraceMetadataV1(metadata);
  const explicit = normalized.tags?.use_type;
  if (explicit === "runtime" || explicit === "audit") return explicit;
  const action = (normalized.custom as Record<string, unknown> | undefined)?.action;
  return typeof action === "string" && action.trim() ? "audit" : "runtime";
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json([] as AuditLogView[]);
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const supabase = createVectorBeaAdminClient();

    const { data, error } = await supabase
      .from("audit_logs")
      .select("id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    const logs: AuditLogView[] = (data ?? []).map((row) => ({
      timestamp: row.created_at,
      workspaceId,
      promptName: row.prompt_name ?? "",
      versionTag: row.version_tag ?? "",
      proxyLatencyMs: resolveAuditProxyLatencyMs(row.proxy_latency_ms, row.metadata),
      llmLatencyMs: resolveAuditLlmLatencyMs(row.llm_latency_ms, row.metadata),
      tokenCount: row.token_count ?? 0,
      useType: resolveUseType((row.metadata as Record<string, unknown>) ?? {}),
      metadata: (row.metadata as Record<string, unknown>) ?? {},
    }));

    return NextResponse.json(logs);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load audit logs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
