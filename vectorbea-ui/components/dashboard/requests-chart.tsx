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
import { Activity, Cpu } from "lucide-react";
import { toast } from "sonner";

import type { AgentMetricPoint } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

type AgentOption = {
  id: string;
  name: string;
  lastHeartbeat: string | null;
};

function formatMetricTime(createdAt: string) {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isOnline(lastHeartbeat: string | null) {
  if (!lastHeartbeat) return false;
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
            <span
              className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
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
        const response = await fetch(
          `/api/agents?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          { cache: "no-store" },
        );
        const data = (await response.json().catch(() => [])) as Array<{
          id: string;
          name: string;
          lastHeartbeat: string | null;
        }>;

        if (!response.ok) throw new Error("Failed to load agents");
        if (cancelled) return;

        setAgents(data);
        setSelectedAgentId((current) => {
          if (current && data.some((agent) => agent.id === current)) return current;
          return data.find((agent) => isOnline(agent.lastHeartbeat))?.id ?? data[0]?.id ?? "";
        });
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load deployment agents.");
        }
      } finally {
        if (!cancelled) setLoadingAgents(false);
      }
    }

    void loadAgents();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      if (!selectedAgentId || !activeWorkspaceId) {
        setChartPoints([]);
        return;
      }

      try {
        setLoadingMetrics(true);
        const response = await fetch(
          `/api/agents/${selectedAgentId}/metrics?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          { cache: "no-store" },
        );
        const data = (await response.json().catch(() => [])) as AgentMetricPoint[] | { error?: string };

        if (!response.ok) {
          throw new Error("error" in data && data.error ? data.error : "Failed to load agent metrics.");
        }

        if (!cancelled) {
          setChartPoints((data as AgentMetricPoint[]).slice(-50));
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load agent metrics.");
        }
      } finally {
        if (!cancelled) setLoadingMetrics(false);
      }
    }

    void loadMetrics();

    const interval = window.setInterval(() => {
      void loadMetrics();
    }, 35_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedAgentId, activeWorkspaceId]);

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
          <div className="min-w-[220px]">
            <Select
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              className="h-9 bg-background"
              disabled={loadingAgents || agents.length === 0}
            >
              {agents.length === 0 ? (
                <option value="">{loadingAgents ? "Loading agents..." : "No agents found"}</option>
              ) : (
                agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} {isOnline(agent.lastHeartbeat) ? "· Online" : "· Offline"}
                  </option>
                ))
              )}
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        {selectedAgent && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isOnline(selectedAgent.lastHeartbeat) ? "success" : "destructive"}>
              {isOnline(selectedAgent.lastHeartbeat) ? "Online" : "Offline"}
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
                : selectedAgentId
                  ? "Waiting for the first heartbeat - data appears every 30 s."
                  : "Select an agent to view live telemetry."}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
