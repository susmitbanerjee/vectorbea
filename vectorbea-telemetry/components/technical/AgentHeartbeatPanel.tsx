"use client";

import { Card, Title, Text, Badge } from "@tremor/react";
import { Activity } from "lucide-react";
import type { AgentHeartbeatRow } from "@/lib/queries/technical";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** 30 buckets, each covering 1 minute, newest on the right. */
const BUCKETS = 30;

function buildDots(ticks: string[], nowMs: number): boolean[] {
  // bucket[i] = true if at least one tick falls within minute i (0 = oldest)
  const dots = Array<boolean>(BUCKETS).fill(false);
  for (const iso of ticks) {
    const ageMs = nowMs - new Date(iso).getTime();
    const minuteAgo = Math.floor(ageMs / 60_000); // 0 = <1 min ago
    const idx = BUCKETS - 1 - minuteAgo;
    if (idx >= 0 && idx < BUCKETS) dots[idx] = true;
  }
  return dots;
}

function statusColor(
  status: AgentHeartbeatRow["status"],
): "emerald" | "rose" | "yellow" | "gray" {
  switch (status) {
    case "online":   return "emerald";
    case "offline":  return "rose";
    case "degraded": return "yellow";
    default:         return "gray";
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const secs   = Math.floor(diffMs / 1_000);
  if (secs <  60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// ── Row ───────────────────────────────────────────────────────────────────────

function AgentRow({ agent, nowMs }: { agent: AgentHeartbeatRow; nowMs: number }) {
  const dots = buildDots(agent.recentTicks, nowMs);
  const tickCount = agent.recentTicks.length;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-gray-800 bg-gray-800/40 p-3 md:flex-row md:items-center md:gap-4">
      {/* ── Status + name ── */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Badge color={statusColor(agent.status)} size="sm">
          {agent.status}
        </Badge>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-200">{agent.name}</p>
          {agent.workspaceId && (
            <p className="font-mono text-xs text-gray-600">
              ws: {agent.workspaceId.slice(0, 8)}…
            </p>
          )}
        </div>
      </div>

      {/* ── 30-min dot timeline ── */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-[3px]" title="Last 30 minutes (each dot = 1 min)">
          {dots.map((active, i) => (
            <span
              key={i}
              className={[
                "inline-block h-2.5 w-2.5 rounded-sm transition-colors",
                active ? "bg-emerald-500" : "bg-gray-700",
              ].join(" ")}
              title={`${BUCKETS - i} min ago: ${active ? "heartbeat received" : "no heartbeat"}`}
            />
          ))}
        </div>
        <p className="text-right text-[10px] text-gray-600">
          {tickCount} tick{tickCount !== 1 ? "s" : ""} · last 30 min
        </p>
      </div>

      {/* ── Stats ── */}
      <div className="flex shrink-0 items-center gap-4 text-right text-xs">
        <div>
          <p className="text-gray-600">Avg latency</p>
          <p className="tabular-nums text-gray-300">
            {agent.avgLatencyMs !== null ? `${agent.avgLatencyMs} ms` : "—"}
          </p>
        </div>
        <div>
          <p className="text-gray-600">Last seen</p>
          <p className="text-gray-300">{formatRelative(agent.lastHeartbeat)}</p>
        </div>
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface Props {
  agents: AgentHeartbeatRow[];
}

export function AgentHeartbeatPanel({ agents }: Props) {
  // Capture a stable "now" for all dot calculations so rows are consistent.
  const nowMs = Date.now();

  const onlineCount  = agents.filter((a) => a.status === "online").length;
  const offlineCount = agents.filter((a) => a.status !== "online").length;

  return (
    <Card className="bg-gray-900 border-gray-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400" />
          <Title className="text-gray-100">Agent Heartbeats</Title>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {onlineCount} online
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
            {offlineCount} offline
          </span>
        </div>
      </div>
      <Text className="text-gray-500 text-xs mt-0.5">
        Each dot = 1 minute window · last 30 minutes
      </Text>

      {agents.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm text-gray-600">
          No agents match the current filter
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} nowMs={nowMs} />
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 border-t border-gray-800 pt-3 text-[10px] text-gray-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />
          Heartbeat received
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-gray-700" />
          No heartbeat
        </span>
        <span className="ml-auto">← 30 min ago · now →</span>
      </div>
    </Card>
  );
}
