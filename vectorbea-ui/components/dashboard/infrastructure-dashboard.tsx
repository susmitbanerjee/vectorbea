"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clock3,
  Copy,
  Cpu,
  HardDrive,
  RefreshCw,
  Server,
  ShieldPlus,
} from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentMetricPoint, DeploymentAgentView, RegisterAgentResponse } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

function isAgentOnline(lastHeartbeat: string | null) {
  if (!lastHeartbeat) return false;
  return Date.now() - new Date(lastHeartbeat).getTime() <= 2 * 60 * 1000;
}

function formatHeartbeat(lastHeartbeat: string | null) {
  if (!lastHeartbeat) {
    return "Never reported";
  }

  return new Date(lastHeartbeat).toLocaleString();
}

export function InfrastructureDashboard() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const [agents, setAgents] = useState<DeploymentAgentView[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<AgentMetricPoint[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [syncingAgentId, setSyncingAgentId] = useState<string | null>(null);

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;

  const chartData = useMemo(
    () =>
      metrics.map((point) => ({
        time: new Date(point.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        cpuUsagePercent: point.cpuUsagePercent,
        memoryUsageMb: point.memoryUsageMb,
      })),
    [metrics],
  );

  const onlineAgents = useMemo(
    () => agents.filter((agent) => isAgentOnline(agent.lastHeartbeat)).length,
    [agents],
  );

  useEffect(() => {
    setSelectedAgentId((current) => {
      if (current && agents.some((agent) => agent.id === current)) {
        return current;
      }
      return agents[0]?.id ?? null;
    });
  }, [agents]);

  useEffect(() => {
    let cancelled = false;

    async function loadAgents() {
      if (!activeWorkspaceId) {
        setAgents([]);
        setLoadingAgents(false);
        return;
      }

      try {
        if (!cancelled) {
          setLoadingAgents(true);
        }
        const response = await fetch(
          `/api/agents?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json().catch(() => [])) as
          | DeploymentAgentView[]
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : "Failed to load deployment agents.",
          );
        }

        if (!cancelled) {
          setAgents(payload as DeploymentAgentView[]);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to load agents.");
        }
      } finally {
        if (!cancelled) {
          setLoadingAgents(false);
        }
      }
    }

    void loadAgents();
    const interval = window.setInterval(() => {
      void loadAgents();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeWorkspaceId]);

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      if (!activeWorkspaceId || !selectedAgent) {
        setMetrics([]);
        return;
      }

      try {
        if (!cancelled) {
          setLoadingMetrics(true);
        }
        const response = await fetch(
          `/api/agents/${selectedAgent.id}/metrics?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json().catch(() => [])) as
          | AgentMetricPoint[]
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : "Failed to load agent metrics.",
          );
        }

        if (!cancelled) {
          setMetrics(payload as AgentMetricPoint[]);
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
    const interval = window.setInterval(() => {
      void loadMetrics();
    }, 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeWorkspaceId, selectedAgent]);

  const handleRegisterAgent = async () => {
    if (!activeWorkspaceId) {
      toast.error("Select a workspace before registering an agent.");
      return;
    }

    const trimmedName = agentName.trim();
    if (!trimmedName) {
      toast.error("Agent name is required.");
      return;
    }

    setRegistering(true);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          name: trimmedName,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | RegisterAgentResponse
        | { error?: string };

      if (!response.ok || !("token" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Failed to register deployment agent.",
        );
      }

      setAgents((current) => [payload.agent, ...current]);
      setSelectedAgentId(payload.agent.id);
      setRevealedToken(payload.token);
      setAgentName("");
      toast.success("Agent registered. Copy the token before closing.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to register deployment agent.");
    } finally {
      setRegistering(false);
    }
  };

  const handleSyncConfig = async (agentId: string) => {
    if (!activeWorkspaceId) {
      toast.error("Select a workspace before syncing an agent.");
      return;
    }

    setSyncingAgentId(agentId);
    try {
      const response = await fetch(`/api/agents/${agentId}/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to enqueue sync command.");
      }

      toast.success("Sync command queued. The agent will pick it up on its next heartbeat.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to enqueue sync command.");
    } finally {
      setSyncingAgentId(null);
    }
  };

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Infrastructure"
        subtitle={`Monitor self-hosted agents connected to ${activeWorkspace?.name ?? "this workspace"}.`}
        actions={
          <Button
            type="button"
            onClick={() => {
              setRegisterOpen(true);
              setRevealedToken(null);
            }}
          >
            <ShieldPlus className="h-4 w-4" />
            Register New Agent
          </Button>
        }
      />

      <Dialog
        open={registerOpen}
        onOpenChange={(open) => {
          setRegisterOpen(open);
          if (!open) {
            setRevealedToken(null);
            setAgentName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {revealedToken ? "Agent token generated" : "Register a new outbound agent"}
            </DialogTitle>
            <DialogDescription>
              {revealedToken
                ? "This token is only shown once. Copy it now and pass it to your container."
                : "Create a new agent identity for the current workspace."}
            </DialogDescription>
          </DialogHeader>

          {revealedToken ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm font-medium">Pass this as `VECTORBEA_AGENT_TOKEN` to your Docker container.</p>
                <code className="mt-3 block overflow-x-auto rounded-lg bg-slate-950 px-4 py-3 font-mono text-sm text-slate-100">
                  {revealedToken}
                </code>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(revealedToken);
                    toast.success("Agent token copied.");
                  }}
                >
                  <Copy className="h-4 w-4" />
                  Copy token
                </Button>
                <Button type="button" onClick={() => setRegisterOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void handleRegisterAgent();
              }}
            >
              <div className="space-y-2">
                <label
                  htmlFor="agent-name"
                  className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                >
                  Agent name
                </label>
                <Input
                  id="agent-name"
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                  placeholder="acme-prod-cluster-1"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setRegisterOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={registering || !agentName.trim()}>
                  {registering ? "Generating..." : "Generate token"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
        <section className="grid gap-4 md:grid-cols-3">
          <Card className="animate-slide-up">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                <Server className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{agents.length}</p>
                <p className="text-xs text-muted-foreground">Registered agents</p>
              </div>
            </CardContent>
          </Card>
          <Card className="animate-slide-up stagger-1">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10">
                <Activity className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{onlineAgents}</p>
                <p className="text-xs text-muted-foreground">Online in the last 2 minutes</p>
              </div>
            </CardContent>
          </Card>
          <Card className="animate-slide-up stagger-2">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10">
                <Clock3 className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{Math.max(agents.length - onlineAgents, 0)}</p>
                <p className="text-xs text-muted-foreground">Offline or stale agents</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <Card className="animate-slide-up">
            <CardHeader>
              <CardTitle>Deployment agents</CardTitle>
              <CardDescription>
                Agents heartbeat from customer-owned Docker or Kubernetes environments.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last heartbeat</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingAgents ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        Loading agents...
                      </TableCell>
                    </TableRow>
                  ) : agents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No agents registered yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    agents.map((agent) => {
                      const online = isAgentOnline(agent.lastHeartbeat);
                      const selected = agent.id === selectedAgent?.id;
                      return (
                        <TableRow
                          key={agent.id}
                          className={selected ? "bg-primary/5" : undefined}
                          onClick={() => setSelectedAgentId(agent.id)}
                        >
                          <TableCell>
                            <div>
                              <p className="font-medium">{agent.name}</p>
                              <p className="text-xs text-muted-foreground">{agent.id}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={online ? "success" : "destructive"}>
                              {online ? "Online" : "Offline"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatHeartbeat(agent.lastHeartbeat)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleSyncConfig(agent.id);
                              }}
                              disabled={syncingAgentId === agent.id}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              {syncingAgentId === agent.id ? "Queueing..." : "Sync Config"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="animate-slide-up stagger-1">
            <CardHeader>
              <CardTitle>Agent details</CardTitle>
              <CardDescription>
                Select an agent to inspect recent heartbeat metrics and replica health.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedAgent ? (
                <>
                  <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{selectedAgent.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Last heartbeat: {formatHeartbeat(selectedAgent.lastHeartbeat)}
                        </p>
                      </div>
                      <Badge variant={isAgentOnline(selectedAgent.lastHeartbeat) ? "success" : "destructive"}>
                        {isAgentOnline(selectedAgent.lastHeartbeat) ? "Online" : "Offline"}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-border/60 bg-card/50 p-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Cpu className="h-4 w-4" />
                        CPU usage
                      </div>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">
                        {metrics.at(-1)?.cpuUsagePercent?.toFixed(1) ?? "0.0"}%
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card/50 p-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <HardDrive className="h-4 w-4" />
                        Memory usage
                      </div>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">
                        {metrics.at(-1)?.memoryUsageMb?.toFixed(0) ?? "0"} MB
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-6 text-sm text-muted-foreground">
                  Register an agent to start receiving infrastructure metrics.
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="animate-slide-up stagger-2">
            <CardHeader>
              <CardTitle>Last 30 minutes</CardTitle>
              <CardDescription>
                CPU and memory usage streamed from the selected agent every heartbeat.
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[360px]">
              {selectedAgent && chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ left: 12, right: 12, top: 8, bottom: 0 }}>
                    <XAxis
                      dataKey="time"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                    />
                    <YAxis
                      yAxisId="cpu"
                      tickLine={false}
                      axisLine={false}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickFormatter={(value) => `${value}%`}
                    />
                    <YAxis
                      yAxisId="memory"
                      orientation="right"
                      tickLine={false}
                      axisLine={false}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickFormatter={(value) => `${value} MB`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "12px",
                      }}
                    />
                    <Line
                      yAxisId="cpu"
                      type="monotone"
                      dataKey="cpuUsagePercent"
                      name="CPU Usage (%)"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Line
                      yAxisId="memory"
                      type="monotone"
                      dataKey="memoryUsageMb"
                      name="Memory Usage (MB)"
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
                    ? "Loading recent metrics..."
                    : "No heartbeat data available for the selected agent yet."}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
