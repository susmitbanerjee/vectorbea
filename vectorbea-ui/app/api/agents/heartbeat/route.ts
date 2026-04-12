import { NextRequest, NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HeartbeatPayload = {
  metrics?: {
    latencyMs?: number;
    latency_ms?: number;
    cpuUsagePercent?: number;
    cpu_usage_percent?: number;
    memoryUsageMb?: number;
    memory_usage_mb?: number;
    activeReplicas?: number;
    active_replicas?: number;
    status?: string;
  };
};

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function getFiniteNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeStatus(value: unknown) {
  if (typeof value !== "string") {
    return "online";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "online" || normalized === "offline" || normalized === "degraded" || normalized === "error") {
    return normalized;
  }

  return "online";
}

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header." },
        { status: 401 },
      );
    }

    const payload = (await request.json().catch(() => ({}))) as HeartbeatPayload;
    const metrics = payload.metrics;

    if (!metrics) {
      return NextResponse.json(
        { error: "Heartbeat payload must include metrics." },
        { status: 400 },
      );
    }

    const cpuUsagePercent = getFiniteNumber(
      metrics.cpuUsagePercent ?? metrics.cpu_usage_percent,
    );
    const latencyMs = Math.max(
      0,
      getFiniteNumber(metrics.latencyMs ?? metrics.latency_ms),
    );
    const memoryUsageMb = Math.max(
      0,
      Math.round(getFiniteNumber(metrics.memoryUsageMb ?? metrics.memory_usage_mb)),
    );
    const activeReplicas = Math.max(
      0,
      Math.round(getFiniteNumber(metrics.activeReplicas ?? metrics.active_replicas, 1)),
    );
    const status = normalizeStatus(metrics.status);

    const supabase = createSupabaseAdminClient();
    const { data: agent, error: agentError } = await supabase
      .from("deployment_agents")
      .select("id, workspace_id, name")
      .eq("api_token", token)
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { error: "Invalid deployment agent token." },
        { status: 401 },
      );
    }

    const now = new Date().toISOString();

    const { error: metricsError } = await supabase
      .from("agent_metrics")
      .insert({
        agent_id: agent.id,
        latency_ms: latencyMs,
        cpu_usage_percent: cpuUsagePercent,
        memory_usage_mb: memoryUsageMb,
        active_replicas: activeReplicas,
        created_at: now,
      });

    if (metricsError) {
      throw new Error(`Failed to store agent metrics: ${metricsError.message}`);
    }

    const { error: heartbeatError } = await supabase
      .from("deployment_agents")
      .update({
        last_heartbeat: now,
        status,
      })
      .eq("id", agent.id);

    if (heartbeatError) {
      throw new Error(`Failed to update agent heartbeat: ${heartbeatError.message}`);
    }

    const { data: pendingCommands, error: commandsError } = await supabase
      .from("agent_commands")
      .select("id, command_type, payload, status, created_at")
      .eq("agent_id", agent.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (commandsError) {
      throw new Error(`Failed to fetch pending agent commands: ${commandsError.message}`);
    }

    return NextResponse.json({
      acknowledged: true,
      agent: {
        id: agent.id,
        workspaceId: agent.workspace_id,
        name: agent.name,
        status,
        lastHeartbeat: now,
      },
      pendingCommands: pendingCommands ?? [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to process agent heartbeat.",
      },
      { status: 500 },
    );
  }
}
