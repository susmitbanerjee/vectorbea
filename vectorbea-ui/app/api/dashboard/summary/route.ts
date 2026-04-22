import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import type { DashboardSummary } from "@/lib/api";

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
      return NextResponse.json({
        totalApiCallsLast24h: 0,
        auditsThisMonth: 0,
        averageLatencyMs: 0,
        activeAgents: 0,
      } as DashboardSummary);
    }

    // ── P0: Tenant isolation gate ──────────────────────────────────────────
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    // ──────────────────────────────────────────────────────────────────────

    const supabase = createVectorBeaAdminClient();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthStartIso = monthStart.toISOString();

    const [{ data: auditData24h }, { data: auditDataMonth }, { data: agentData }] = await Promise.all([
      supabase
        .from("audit_logs")
        .select("proxy_latency_ms, metadata")
        .eq("workspace_id", workspaceId)
        .gte("created_at", since),
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

    const runtimeRows24h = (auditData24h ?? []).filter(
      (row) => resolveUseType((row.metadata as Record<string, unknown>) ?? {}) === "runtime",
    );
    const auditRowsMonth = (auditDataMonth ?? []).filter(
      (row) => resolveUseType((row.metadata as Record<string, unknown>) ?? {}) === "audit",
    );

    const totalApiCallsLast24h = runtimeRows24h.length;
    const averageLatencyMs = runtimeRows24h.length > 0
      ? Math.round(
          runtimeRows24h.reduce((sum, r) => sum + (r.proxy_latency_ms ?? 0), 0) /
            runtimeRows24h.length,
        )
      : 0;
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const activeAgents = (agentData ?? []).filter(
      (agent) => agent.last_heartbeat && agent.last_heartbeat >= twoMinutesAgo,
    ).length;

    return NextResponse.json({
      totalApiCallsLast24h,
      auditsThisMonth: auditRowsMonth.length,
      averageLatencyMs,
      activeAgents,
    } as DashboardSummary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard summary" },
      { status: 500 },
    );
  }
}
