"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Server, Zap, ServerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getWorkers, type WorkerItem } from "@/lib/repository";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG = {
  CONNECTED:    { dot: "bg-emerald-500", text: "text-emerald-700", label: "Connected",    bg: "bg-emerald-50", border: "border-emerald-200" },
  IDLE:         { dot: "bg-blue-400",    text: "text-blue-700",    label: "Idle",         bg: "bg-blue-50",    border: "border-blue-200"    },
  DISCONNECTED: { dot: "bg-red-500",     text: "text-red-700",     label: "Disconnected", bg: "bg-red-50",     border: "border-red-200"     },
};

const ACCENT_COLOR: Record<string, string> = {
  emerald: "#059669",
  blue:    "#1D4ED8",
  amber:   "#D97706",
  red:     "#DC2626",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

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

function CapacityBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const barColor = pct >= 80 ? "#D97706" : pct >= 60 ? "#2563EB" : "#059669";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full" style={{ background: "#E5E7EB" }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
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
  const [workers, setWorkers]   = useState<WorkerItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    const data = await getWorkers();
    setWorkers(data);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function handleRefresh() {
    void load(true);
  }

  const connected = workers.filter(w => w.status === "CONNECTED").length;
  const idle      = workers.filter(w => w.status === "IDLE").length;
  const totalActive   = workers.reduce((a, w) => a + (w.activeTasks ?? 0), 0);
  const totalCapacity = workers.reduce((a, w) => a + (w.maxCapacity ?? 0), 0);

  return (
    <div className="page-shell" style={{ color: "var(--text-primary)" }}>

      {/* ── Page header */}
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
          disabled={refreshing || loading}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all disabled:opacity-50"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--legacy-border-subtle)",
            color: "var(--text-secondary)",
          }}
          onMouseOver={e => (e.currentTarget.style.borderColor = "var(--legacy-border-strong)")}
          onMouseOut={e => (e.currentTarget.style.borderColor = "var(--legacy-border-subtle)")}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", (refreshing || loading) && "animate-spin")} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : workers.length === 0 ? (
        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 text-center">
          <ServerOff className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-muted-foreground">No workers connected</p>
          <p className="text-xs text-muted-foreground">
            Start a worker process to see it appear here.
          </p>
        </div>
      ) : (
        <>
          {/* ── Metric cards */}
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label="Connected"
              value={`${connected} / ${workers.length}`}
              sub={idle > 0 ? `${idle} idle worker${idle > 1 ? "s" : ""}` : "All workers active"}
              accent="emerald"
              icon={Server}
            />
            <MetricCard
              label="Active Tasks"
              value={String(totalActive)}
              sub="Across all queues"
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
              label="Workers Online"
              value={String(connected)}
              sub={connected === workers.length ? "All workers healthy" : `${workers.length - connected} offline`}
              accent={connected === workers.length ? "emerald" : "amber"}
            />
          </div>

          {/* ── Worker fleet table */}
          <div className="overflow-hidden rounded-lg bg-white border border-border shadow-card">
            <div
              className="flex items-center justify-between px-5 py-3.5"
              style={{ borderBottom: "1px solid var(--legacy-border-subtle)" }}
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
                  <tr style={{ borderBottom: "1px solid var(--legacy-border-subtle)" }}>
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
                  {workers.map((w, i) => {
                    const cfg = STATUS_CFG[w.status] ?? STATUS_CFG.DISCONNECTED;
                    return (
                      <tr
                        key={w.id}
                        className="group transition-colors"
                        style={i < workers.length - 1 ? { borderBottom: "1px solid #E5E7EB" } : {}}
                        onMouseOver={e => (e.currentTarget.style.background = "var(--surface-hover)")}
                        onMouseOut={e => (e.currentTarget.style.background = "")}
                      >
                        <td className="px-5 py-3.5">
                          <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                            {w.id.slice(0, 12)}
                          </p>
                          {w.host && (
                            <p className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
                              {w.host}
                            </p>
                          )}
                        </td>
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
                        <td className="px-5 py-3.5">
                          {w.queue ? (
                            <span
                              className="rounded border px-1.5 py-0.5 font-mono text-[11px]"
                              style={{ background: "var(--surface-3)", border: "1px solid var(--legacy-border-subtle)", color: "var(--text-muted)" }}
                            >
                              {w.queue}
                            </span>
                          ) : <span className="text-[11px] text-muted-foreground">—</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          {w.maxCapacity != null ? (
                            <CapacityBar used={w.activeTasks ?? 0} total={w.maxCapacity} />
                          ) : <span className="text-[11px] text-muted-foreground">—</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="font-mono text-[12px]" style={{ color: w.status !== "DISCONNECTED" ? "#059669" : "#DC2626" }}>
                            {w.heartbeat ?? "—"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
                            {w.version ?? "—"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {w.region ?? "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-4 text-[11px] font-mono" style={{ color: "var(--text-faint)" }}>
            Workers poll every 500ms · Heartbeat timeout 30s · 3 missed = disconnected
          </p>
        </>
      )}
    </div>
  );
}
