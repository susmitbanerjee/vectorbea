"use client";

import { useState } from "react";
import { RefreshCw, Server } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─── Mock data ────────────────────────────────────────────────────────────────

interface Worker {
  id: string;
  shortId: string;
  status: "CONNECTED" | "IDLE" | "DISCONNECTED";
  queue: string;
  activeTasks: number;
  maxCapacity: number;
  heartbeat: string;
  version: string;
  host: string;
}

const MOCK_WORKERS: Worker[] = [
  {
    id: "wkr_01HZB2X8K9QRJM4N7VTCPD6WF",
    shortId: "wkr-01HZB2",
    status: "CONNECTED",
    queue: "default",
    activeTasks: 3,
    maxCapacity: 8,
    heartbeat: "2s ago",
    version: "v0.9.4",
    host: "worker-prod-1.us-east-1",
  },
  {
    id: "wkr_02KCP5Y9L0RSKN5O8WUDQE7XG",
    shortId: "wkr-02KCP5",
    status: "CONNECTED",
    queue: "priority",
    activeTasks: 1,
    maxCapacity: 4,
    heartbeat: "4s ago",
    version: "v0.9.4",
    host: "worker-prod-2.us-east-1",
  },
  {
    id: "wkr_03LDQ6Z0M1STLO6P9XVERH8YH",
    shortId: "wkr-03LDQ6",
    status: "IDLE",
    queue: "default",
    activeTasks: 0,
    maxCapacity: 8,
    heartbeat: "8s ago",
    version: "v0.9.3",
    host: "worker-prod-3.us-east-1",
  },
];

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  CONNECTED: {
    dot: "bg-emerald-500",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    label: "Connected",
  },
  IDLE: {
    dot: "bg-blue-400",
    badge: "border-blue-200 bg-blue-50 text-blue-700",
    label: "Idle",
  },
  DISCONNECTED: {
    dot: "bg-red-400",
    badge: "border-red-200 bg-red-50 text-red-700",
    label: "Disconnected",
  },
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function WorkersPage() {
  const [refreshing, setRefreshing] = useState(false);

  const totalActive = MOCK_WORKERS.reduce((acc, w) => acc + w.activeTasks, 0);
  const totalCapacity = MOCK_WORKERS.reduce((acc, w) => acc + w.maxCapacity, 0);
  const connected = MOCK_WORKERS.filter((w) => w.status === "CONNECTED").length;

  function handleRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }

  return (
    <div className="space-y-6 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Workers</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Active worker processes and execution capacity.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-5 rounded-lg border border-border bg-muted/30 px-5 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Workers</p>
          <p className="mt-0.5 text-[18px] font-semibold leading-none">{MOCK_WORKERS.length}</p>
        </div>
        <div className="h-8 w-px bg-border" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Connected</p>
          <p className="mt-0.5 text-[18px] font-semibold leading-none text-emerald-600">{connected}</p>
        </div>
        <div className="h-8 w-px bg-border" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Active Tasks</p>
          <p className="mt-0.5 text-[18px] font-semibold leading-none">{totalActive}</p>
        </div>
        <div className="h-8 w-px bg-border" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Max Capacity</p>
          <p className="mt-0.5 text-[18px] font-semibold leading-none">{totalCapacity}</p>
        </div>
        <div className="h-8 w-px bg-border" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">Last Heartbeat</p>
          <p className="mt-0.5 text-[13px] font-medium leading-none">2s ago</p>
        </div>
      </div>

      {/* Workers table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {["Worker ID", "Status", "Queue", "Active Tasks", "Heartbeat", "Version", "Capacity", ""].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {MOCK_WORKERS.map((w) => {
                  const cfg = STATUS_CONFIG[w.status];
                  const pct = Math.round((w.activeTasks / w.maxCapacity) * 100);
                  return (
                    <tr key={w.id} className="group transition-colors hover:bg-muted/20">
                      {/* Worker ID */}
                      <td className="px-5 py-3.5">
                        <p className="text-[13px] font-medium">{w.shortId}</p>
                        <p className="font-mono text-[10px] text-muted-foreground/60">{w.host}</p>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3.5">
                        <Badge className={cn("gap-1.5 text-[10px]", cfg.badge)}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot)} />
                          {cfg.label}
                        </Badge>
                      </td>

                      {/* Queue */}
                      <td className="px-5 py-3.5">
                        <span className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {w.queue}
                        </span>
                      </td>

                      {/* Active Tasks */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-medium">
                            {w.activeTasks}/{w.maxCapacity}
                          </span>
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                pct >= 80 ? "bg-amber-400" : "bg-emerald-500",
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Heartbeat */}
                      <td className="px-5 py-3.5">
                        <span className="text-[12px] text-muted-foreground">{w.heartbeat}</span>
                      </td>

                      {/* Version */}
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-[11px] text-muted-foreground">{w.version}</span>
                      </td>

                      {/* Capacity bar */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary/60"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[11px] text-muted-foreground">{pct}%</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3.5">
                        <button
                          type="button"
                          className="text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Info note */}
      <p className="text-[11px] text-muted-foreground/60">
        Workers poll the task queue every 500ms. Heartbeat timeout is 30s — workers that miss 3 consecutive heartbeats are marked disconnected.
      </p>
    </div>
  );
}
