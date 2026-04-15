import { NextRequest, NextResponse } from "next/server";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import type { DashboardSummary } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ totalApiCallsLast24h: 0, averageLatencyMs: 0, activeAgents: 0 } as DashboardSummary);
    }

    const supabase = createVectorBeaAdminClient();

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("organization_id")
      .eq("id", workspaceId)
      .single();

    if (!workspace?.organization_id) {
      return NextResponse.json({ totalApiCallsLast24h: 0, averageLatencyMs: 0, activeAgents: 0 } as DashboardSummary);
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ data: auditData }, { data: agentData }] = await Promise.all([
      supabase
        .from("audit_logs")
        .select("proxy_latency_ms")
        .eq("organization_id", workspace.organization_id)
        .gte("created_at", since),
      supabase
        .from("deployment_agents")
        .select("id")
        .eq("workspace_id", workspaceId),
    ]);

    const rows = auditData ?? [];
    const totalApiCallsLast24h = rows.length;
    const averageLatencyMs = rows.length > 0
      ? Math.round(rows.reduce((sum, r) => sum + (r.proxy_latency_ms ?? 0), 0) / rows.length)
      : 0;
    const activeAgents = agentData?.length ?? 0;

    return NextResponse.json({ totalApiCallsLast24h, averageLatencyMs, activeAgents } as DashboardSummary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard summary" },
      { status: 500 },
    );
  }
}
