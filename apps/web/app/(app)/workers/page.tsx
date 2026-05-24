"use client";

import { useState } from "react";
import { Activity, RefreshCw, Server, Zap } from "lucide-react";
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
  region: string;
  uptimeHrs: number;
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
    region: "us-east-1",
    uptimeHrs: 142,
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
    region: "us-east-1",
    uptimeHrs: 97,
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
    region: "us-east-1",
    uptimeHrs: 58,
  },
];

const QUEUE_HEALTH = [
  { name: "default",         waiting: 2,  active: 3,  delayed: 0, failed: 0,  color: "#2563EB" },
  { name: "priority",        waiting: 0,  active: 1,  delayed: 0, failed: 0,  color: "#0369A1" },
  { name: "delayed",         waiting: 4,  active: 0,  delayed: 4, failed: 0,  color: "#D97706" },
  { name: "dead-letter",     waiting: 0,  active: 0,  delayed: 0, failed: 3,  color: "#DC2626" },
];

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG = {
  CONNECTED:    { dot: "bg-emerald-500", text: "text-emerald-700", label: "Connected",    bg: "bg-emerald-50", border: "border-emerald-200" },
  IDLE:         { dot: "bg-blue-400",    text: "text-blue-700",    label: "Idle",         bg: "bg-blue-50",    border: "border-blue-200"    },
  DISCONNECTED: { dot: "bg-red-500",     text: "text-red-700",     label: "Disconnected", bg: "bg-red-50",     border: "border-red-200"     },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const ACCENT_COLOR: Record<string, string> = {
  emerald: "#059669",
  blue:    "#1D4ED8",
  amber:   "#D97706",
  red:     "#DC2626",
};

function MetricCard({
  label,
  value,
  sub,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: string;
  icon?: React.ElementType;
}) {
  const accentColor = accent ? (ACCENT_COLOR[accent] ?? accent) : undefined;
  return (
    <div className="rounded-lg p-4 flex flex-col gap-2 bg-white border border-border shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9CA3AF]">
          {label}
        </p>
        {Icon && <Icon className="h-3.5 w-3.5 text-[#9CA3AF]" />}
      </div>
      <p
        className="text-[26px] font-semibold leading-none tracking-tight"
        style={{ color: accentColor ?? "var(--text-primary)" }}
      >
        {value}
      </p>
      <p className="text-[12px] text-[#6B7280]">{sub}</p>
    </div>
  );
}

function CapacityBar({ used, total, color = "#2563EB" }: { used: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const barColor = pct >= 80 ? "#D97706" : pct >= 60 ? "#2563EB" : "#059669";
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full"
        style={{ background: "#E5E7EB" }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: color !== "#2563EB" ? color : barColor }}
        />
      </div>
      <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
        {used}/{total}
      </span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkersPage() {
  const [refreshing, setRefreshing] = useState(false);

  const totalActive = MOCK_WORKERS.reduce((a, w) => a + w.activeTasks, 0);
  const totalCapacity = MOCK_WORKERS.reduce((a, w) => a + w.maxCapacity, 0);
  const connected = MOCK_WORKERS.filter(w => w.status === "CONNECTED").length;
  const idle = MOCK_WORKERS.filter(w => w.status === "IDLE").length;

  function handleRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }

  return (
    <div className="page-shell" style={{ color: "var(--text-primary)" }}>

      {/* ── Page header ───────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
            Workers
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: "var(--text-muted)" }}>
            Monitor worker processes, queue assignments, active tasks, and heartbeat health.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all disabled:opacity-50"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
          onMouseOver={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
          onMouseOut={e => (e.currentTarget.style.borderColor = "var(--border-subtle)")}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* ── Metric cards ──────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          label="Connected"
          value={`${connected} / ${MOCK_WORKERS.length}`}
          sub={idle > 0 ? `${idle} idle worker${idle > 1 ? "s" : ""}` : "All workers active"}
          accent="emerald"
          icon={Server}
        />
        <MetricCard
          label="Active Tasks"
          value={String(totalActive)}
          sub="Across default and priority queues"
          accent="blue"
          icon={Zap}
        />
        <MetricCard
          label="Max Capacity"
          value={String(totalCapacity)}
          sub={`${totalCapacity - totalActive} slots available`}
          icon={Activity}
        />
        <MetricCard
          label="Last Heartbeat"
          value="2s ago"
          sub="All workers healthy"
          accent="emerald"
        />
      </div>

      {/* ── Worker fleet table ────────────────────────────────────────── */}
      <div className="mb-6 overflow-hidden rounded-lg bg-white border border-border shadow-card">
        {/* Table header */}
        <div
          className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Worker Fleet
          </p>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0" }}
          >
            {connected} online
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                {["Worker", "Status", "Queue", "Active / Cap.", "Heartbeat", "Version", "Region"].map(h => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--text-faint)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MOCK_WORKERS.map((w, i) => {
                const cfg = STATUS_CFG[w.status];
                return (
                  <tr
                    key={w.id}
                    className="group transition-colors"
                    style={i < MOCK_WORKERS.length - 1 ? { borderBottom: "1px solid #E5E7EB" } : {}}
                    onMouseOver={e => (e.currentTarget.style.background = "var(--surface-hover)")}
                    onMouseOut={e => (e.currentTarget.style.background = "")}
                  >
                    {/* Worker identity */}
                    <td className="px-5 py-3.5">
                      <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                        {w.shortId}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
                        {w.host}
                      </p>
                    </td>

                    {/* Status badge */}
                    <td className="px-5 py-3.5">
                      <span
                        className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", cfg.bg, cfg.border)}
                      >
                        <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dot,
                          w.status === "CONNECTED" && "animate-pulse"
                        )} />
                        <span className={cfg.text}>{cfg.label}</span>
                      </span>
                    </td>

                    {/* Queue chip */}
                    <td className="px-5 py-3.5">
                      <span
                        className="rounded border px-1.5 py-0.5 font-mono text-[11px]"
                        style={{ background: "var(--surface-3)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
                      >
                        {w.queue}
                      </span>
                    </td>

                    {/* Capacity */}
                    <td className="px-5 py-3.5">
                      <CapacityBar used={w.activeTasks} total={w.maxCapacity} />
                    </td>

                    {/* Heartbeat */}
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-[12px]" style={{ color: w.status !== "DISCONNECTED" ? "#059669" : "#DC2626" }}>
                        {w.heartbeat}
                      </span>
                    </td>

                    {/* Version */}
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
                        {w.version}
                      </span>
                    </td>

                    {/* Region */}
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {w.region}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Queue health ──────────────────────────────────────────────── */}
      <div
        className="rounded-xl"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
      >
        <div
          className="px-5 py-3.5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Queue Health
          </p>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
            Job distribution and backlog across all queues.
          </p>
        </div>
        <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0"
          style={{ "--tw-divide-opacity": "1" } as React.CSSProperties}
        >
          {QUEUE_HEALTH.map(q => {
            const total = q.waiting + q.active + q.delayed + q.failed;
            const pct = total === 0 ? 0 : Math.round((q.active / total) * 100);
            return (
              <div key={q.name} className="px-5 py-4" style={{ borderColor: "rgba(148,163,184,0.08)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
                    {q.name}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
                    {total} jobs
                  </span>
                </div>
                {/* Progress bar */}
                <div
                  className="mb-3 h-1.5 w-full overflow-hidden rounded-full"
                  style={{ background: "rgba(148,163,184,0.1)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: total > 0 ? `${pct}%` : "0%", backgroundColor: q.color }}
                  />
                </div>
                <div className="flex gap-4">
                  {[
                    { label: "waiting", val: q.waiting, color: "var(--text-muted)" },
                    { label: "active",  val: q.active,  color: q.color },
                    { label: "delayed", val: q.delayed, color: "#F59E0B" },
                    { label: "failed",  val: q.failed,  color: "#DC2626" },
                  ].map(s => (
                    <div key={s.label}>
                      <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>
                        {s.label}
                      </p>
                      <p className="text-[14px] font-semibold" style={{ color: s.color }}>
                        {s.val}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer note */}
      <p className="mt-4 text-[11px] font-mono" style={{ color: "var(--text-faint)" }}>
        Workers poll every 500ms · Heartbeat timeout 30s · 3 missed = disconnected
      </p>
    </div>
  );
}
