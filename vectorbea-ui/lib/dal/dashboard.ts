import "server-only";

import type { AuditLogView, DashboardSummary } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

function resolveUseType(metadata: Record<string, unknown>): "runtime" | "audit" {
  const explicit = metadata.useType;
  if (explicit === "runtime" || explicit === "audit") return explicit;
  const action = metadata.action;
  return typeof action === "string" && action.trim() ? "audit" : "runtime";
}

export async function getRecentAuditLogsForWorkspace(
  workspaceId: string,
): Promise<AuditLogView[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select(
      "id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Failed to load audit logs: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    timestamp: row.created_at,
    workspaceId,
    promptName: row.prompt_name ?? "",
    versionTag: row.version_tag ?? "",
    proxyLatencyMs: row.proxy_latency_ms ?? 0,
    llmLatencyMs: row.llm_latency_ms ?? 0,
    tokenCount: row.token_count ?? 0,
    useType: resolveUseType((row.metadata as Record<string, unknown>) ?? {}),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }));
}

export async function getDashboardSummaryForWorkspace(
  workspaceId: string,
  _auditLogs?: AuditLogView[],
): Promise<DashboardSummary> {
  const supabase = createVectorBeaAdminClient();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();

  const [{ data: auditData24h }, { data: auditDataMonth }, { data: agentData, error }] =
    await Promise.all([
      supabase
        .from("audit_logs")
        .select("proxy_latency_ms, metadata")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since24h),
      supabase
        .from("audit_logs")
        .select("metadata")
        .eq("workspace_id", workspaceId)
        .gte("created_at", monthStartIso),
      supabase
        .from("deployment_agents")
        .select("id, last_heartbeat")
        .eq("workspace_id", workspaceId),
    ]);

  if (error) {
    throw new Error(`Failed to load deployment agents: ${error.message}`);
  }

  const runtimeRows24h = (auditData24h ?? []).filter(
    (row) => resolveUseType((row.metadata as Record<string, unknown>) ?? {}) === "runtime",
  );
  const auditRowsMonth = (auditDataMonth ?? []).filter(
    (row) => resolveUseType((row.metadata as Record<string, unknown>) ?? {}) === "audit",
  );
  const averageLatencyMs =
    runtimeRows24h.length > 0
      ? Math.round(
          runtimeRows24h.reduce((sum, row) => sum + (row.proxy_latency_ms ?? 0), 0) /
            runtimeRows24h.length,
        )
      : 0;

  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const activeAgents = (agentData ?? []).filter(
    (agent) => agent.last_heartbeat && agent.last_heartbeat >= twoMinutesAgo,
  ).length;

  return {
    totalApiCallsLast24h: runtimeRows24h.length,
    auditsThisMonth: auditRowsMonth.length,
    averageLatencyMs,
    activeAgents,
  };
}
