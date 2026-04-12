"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, ChevronDown, Cpu } from "lucide-react";
import { toast } from "sonner";

import type { AgentMetricPoint } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { useWorkspace } from "@/lib/workspace-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type AgentOption = {
  id: string;
  name: string;
  status: string;
  last_heartbeat: string | null;
};

function formatMetricTime(createdAt: string) {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mapMetricPoint(row: {
  id: string;
  agent_id: string;
  latency_ms: number;
  cpu_usage_percent: number;
  created_at: string;
}): AgentMetricPoint {
  return {
    id: row.id,
    agentId: row.agent_id,
    latencyMs: row.latency_ms,
    cpuUsagePercent: row.cpu_usage_percent,
    memoryUsageMb: 0,
    activeReplicas: 0,
    createdAt: row.created_at,
  };
}

function isOnline(lastHeartbeat: string | null) {
  if (!lastHeartbeat) {
    return false;
  }

  return Date.now() - new Date(lastHeartbeat).getTime() <= 2 * 60 * 1000;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-xl">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 space-y-1.5">
        {payload.map((entry) => (
          <p key={`${entry.name}-${entry.color}`} className="text-sm font-medium">
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.name}:{" "}
            <span className="tabular-nums">
              {typeof entry.value === "number" ? entry.value.toFixed(1) : entry.value}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

export function RequestsChart() {
  const { activeWorkspaceId } = useWorkspace();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [chartPoints, setChartPoints] = useState<AgentMetricPoint[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;

  const chartData = useMemo(
    () =>
      chartPoints.map((point) => ({
        id: point.id,
        time: formatMetricTime(point.createdAt),
        latencyMs: point.latencyMs,
        cpuUsagePercent: point.cpuUsagePercent,
      })),
    [chartPoints],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadAgents() {
      if (!activeWorkspaceId) {
        setAgents([]);
        setSelectedAgentId("");
        setLoadingAgents(false);
        return;
      }

      try {
        setLoadingAgents(true);
        const { data, error } = await supabase
          .from("deployment_agents")
          .select("id, name, status, last_heartbeat")
          .eq("workspace_id", activeWorkspaceId)
          .order("last_heartbeat", { ascending: false, nullsFirst: false });

        if (error) {
          throw error;
        }

        if (cancelled) {
          return;
        }

        const nextAgents = (data ?? []) as AgentOption[];
        setAgents(nextAgents);
        setSelectedAgentId((current) => {
          if (current && nextAgents.some((agent) => agent.id === current)) {
            return current;
          }
          return nextAgents.find((agent) => isOnline(agent.last_heartbeat))?.id ?? nextAgents[0]?.id ?? "";
        });
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load deployment agents.");
        }
      } finally {
        if (!cancelled) {
          setLoadingAgents(false);
        }
      }
    }

    void loadAgents();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, supabase]);

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      if (!selectedAgentId) {
        setChartPoints([]);
        return;
      }

      try {
        setLoadingMetrics(true);
        const { data, error } = await supabase
          .from("agent_metrics")
          .select("id, agent_id, latency_ms, cpu_usage_percent, created_at")
          .eq("agent_id", selectedAgentId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) {
          throw error;
        }

        if (!cancelled) {
          const mapped = ((data ?? []) as Array<{
            id: string;
            agent_id: string;
            latency_ms: number;
            cpu_usage_percent: number;
            created_at: string;
          }>)
            .map(mapMetricPoint)
            .reverse();
          setChartPoints(mapped);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load agent metrics.");
        }
      } finally {
        if (!cancelled) {
          setLoadingMetrics(false);
        }
      }
    }

    void loadMetrics();

    return () => {
      cancelled = true;
    };
  }, [selectedAgentId, supabase]);

  useEffect(() => {
    if (!selectedAgentId) {
      return;
    }

    const channel = supabase
      .channel(`agent-metrics:${selectedAgentId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "agent_metrics",
          filter: `agent_id=eq.${selectedAgentId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            agent_id: string;
            latency_ms: number;
            cpu_usage_percent: number;
            created_at: string;
          };

          setChartPoints((current) => {
            const next = [...current, mapMetricPoint(row)];
            return next.slice(-50);
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedAgentId, supabase]);

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Live Telemetry</CardTitle>
          <CardDescription>
            Latency and CPU telemetry streamed from the selected outbound agent.
          </CardDescription>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant="outline">Realtime</Badge>
          <div className="relative min-w-[220px]">
            <select
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              className="h-9 w-full appearance-none rounded-lg border border-border/60 bg-background/70 px-3 pr-9 text-sm outline-none transition-colors focus:border-primary/50"
              disabled={loadingAgents || agents.length === 0}
            >
              {agents.length === 0 ? (
                <option value="">{loadingAgents ? "Loading agents..." : "No agents found"}</option>
              ) : (
                agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} {isOnline(agent.last_heartbeat) ? "· Online" : "· Offline"}
                  </option>
                ))
              )}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        {selectedAgent && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isOnline(selectedAgent.last_heartbeat) ? "success" : "destructive"}>
              {isOnline(selectedAgent.last_heartbeat) ? "Online" : "Offline"}
            </Badge>
            <Badge variant="secondary" className="gap-1.5">
              <Activity className="h-3 w-3" />
              Agent: {selectedAgent.name}
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <Cpu className="h-3 w-3" />
              {chartPoints.length} points
            </Badge>
          </div>
        )}

        <div className="h-[320px]">
          {selectedAgentId && chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 0, right: 12, top: 12, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  strokeOpacity={0.5}
                  vertical={false}
                />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "currentColor", fontSize: 12 }}
                  className="text-muted-foreground"
                />
                <YAxis
                  yAxisId="latency"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "currentColor", fontSize: 12 }}
                  className="text-muted-foreground"
                  width={56}
                  tickFormatter={(value: number) => `${Math.round(value)} ms`}
                />
                <YAxis
                  yAxisId="cpu"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "currentColor", fontSize: 12 }}
                  className="text-muted-foreground"
                  width={48}
                  tickFormatter={(value: number) => `${Math.round(value)}%`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  yAxisId="latency"
                  type="monotone"
                  dataKey="latencyMs"
                  name="Latency (ms)"
                  stroke="hsl(var(--chart-1))"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="cpu"
                  type="monotone"
                  dataKey="cpuUsagePercent"
                  name="CPU Usage (%)"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 text-sm text-muted-foreground">
              {loadingMetrics
                ? "Loading live telemetry..."
                : "Select an agent with recent metrics to view live telemetry."}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
