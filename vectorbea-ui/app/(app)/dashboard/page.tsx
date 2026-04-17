import { cookies } from "next/headers";

import type { AuditLogView, DashboardSummary } from "@/lib/api";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; q?: string }>;
}) {
  const { org: workspaceId } = await searchParams;

  let auditLogs: AuditLogView[] = [];
  let dashboardSummary: DashboardSummary = {
    totalApiCallsLast24h: 0,
    averageLatencyMs: 0,
    activeAgents: 0,
  };

  if (workspaceId) {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);

    if (user) {
      const supabase = createVectorBeaAdminClient();
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data } = await supabase
        .from("audit_logs")
        .select("id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(100);

      auditLogs = (data ?? []).map((row) => ({
        timestamp: row.created_at,
        workspaceId,
        promptName: row.prompt_name ?? "",
        versionTag: row.version_tag ?? "",
        proxyLatencyMs: row.proxy_latency_ms ?? 0,
        llmLatencyMs: row.llm_latency_ms ?? 0,
        tokenCount: row.token_count ?? 0,
        metadata: (row.metadata as Record<string, unknown>) ?? {},
      }));

      const recentLogs = auditLogs.filter((log) => log.timestamp >= since24h);
      const averageLatencyMs =
        recentLogs.length > 0
          ? Math.round(recentLogs.reduce((sum, log) => sum + log.proxyLatencyMs, 0) / recentLogs.length)
          : 0;

      const { data: agentData } = await supabase
        .from("deployment_agents")
        .select("id, last_heartbeat")
        .eq("workspace_id", workspaceId);

      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const activeAgents = (agentData ?? []).filter(
        (agent) => agent.last_heartbeat && agent.last_heartbeat >= twoMinutesAgo,
      ).length;

      dashboardSummary = {
        totalApiCallsLast24h: recentLogs.length,
        averageLatencyMs,
        activeAgents,
      };
    }
  }

  return (
    <DashboardOverview
      workspaceId={workspaceId ?? null}
      initialAuditLogs={auditLogs}
      initialSummary={dashboardSummary}
    />
  );
}
