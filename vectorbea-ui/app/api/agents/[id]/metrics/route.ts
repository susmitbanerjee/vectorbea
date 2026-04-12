import { NextRequest, NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toMetricPoint(metric: {
  id: string;
  agent_id: string;
  latency_ms: number;
  cpu_usage_percent: number;
  memory_usage_mb: number;
  active_replicas: number;
  created_at: string;
}) {
  return {
    id: metric.id,
    agentId: metric.agent_id,
    latencyMs: metric.latency_ms,
    cpuUsagePercent: metric.cpu_usage_percent,
    memoryUsageMb: metric.memory_usage_mb,
    activeReplicas: metric.active_replicas,
    createdAt: metric.created_at,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 });
    }

    const windowStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const supabase = createSupabaseAdminClient();

    const { data: agent, error: agentError } = await supabase
      .from("deployment_agents")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();

    if (agentError || !agent) {
      return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("agent_metrics")
      .select("id, agent_id, latency_ms, cpu_usage_percent, memory_usage_mb, active_replicas, created_at")
      .eq("agent_id", id)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to load agent metrics: ${error.message}`);
    }

    return NextResponse.json((data ?? []).map(toMetricPoint));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load agent metrics." },
      { status: 500 },
    );
  }
}
