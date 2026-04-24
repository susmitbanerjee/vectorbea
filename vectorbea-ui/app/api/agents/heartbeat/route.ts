import { NextRequest, NextResponse } from "next/server";

import { authenticateRuntimeApiKey } from "@/lib/server/runtime-api-key";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

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
    const auth = await authenticateRuntimeApiKey(request);
    if (!auth.ok) return auth.response;

    const workspaceId = auth.workspaceId;
    const hostId =
      request.headers.get("x-vectorbea-host-id") ??
      request.headers.get("x-forwarded-for") ??
      "unknown-host";

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

    const supabase = createVectorBeaAdminClient();

    // Upsert deployment agent by workspace_id + name (hostId)
    const { data: existingAgent } = await supabase
      .from("deployment_agents")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .eq("name", hostId)
      .maybeSingle();

    let agentId: string;
    if (existingAgent) {
      agentId = existingAgent.id;
    } else {
      const now = new Date().toISOString();
      const { data: newAgent, error: createError } = await supabase
        .from("deployment_agents")
        .insert({
          workspace_id: workspaceId,
          name: hostId,
          status: "online",
          last_heartbeat: now,
          // api_token has a NOT NULL constraint; heartbeat-registered agents
          // are identified by their workspace API key, not a per-agent token.
          // Store a sentinel so the constraint is satisfied without leaking
          // the Bearer token into this column.
          api_token: `hub-registered:${auth.keyId}`,
        })
        .select("id")
        .single();
      if (createError) throw new Error(createError.message);
      agentId = newAgent.id;
    }

    const now = new Date().toISOString();

    const { error: heartbeatError } = await supabase
      .from("deployment_agents")
      .update({
        last_heartbeat: now,
        status,
      })
      .eq("id", agentId);

    if (heartbeatError) {
      throw new Error(`Failed to update agent heartbeat: ${heartbeatError.message}`);
    }

    const { error: metricsError } = await supabase
      .from("agent_metrics")
      .insert({
        agent_id: agentId,
        latency_ms: latencyMs,
        cpu_usage_percent: cpuUsagePercent,
        memory_usage_mb: memoryUsageMb,
        active_replicas: activeReplicas,
        created_at: now,
      });

    if (metricsError) {
      throw new Error(`Failed to store agent metrics: ${metricsError.message}`);
    }

    const { data: pendingCommands, error: commandsError } = await supabase
      .from("agent_commands")
      .select("id, command_type, payload, status, created_at")
      .eq("agent_id", agentId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (commandsError) {
      throw new Error(`Failed to fetch pending agent commands: ${commandsError.message}`);
    }

    return NextResponse.json({
      acknowledged: true,
      agent: {
        id: agentId,
        workspaceId,
        name: hostId,
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
