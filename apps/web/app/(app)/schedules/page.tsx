"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, Pause, Play, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { Chip, FilterTabs, EmptyHint, StatTile } from "@/components/ui/page-kit";

const API_BASE = process.env.NEXT_PUBLIC_VECTORBEA_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Schedule {
  id: string;
  jobName: string;
  cron: string;
  humanReadable: string;
  timezone: string;
  nextRun: string | null;
  lastRun: string | null;
  status: "ACTIVE" | "PAUSED";
  jobId: string;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SchedulesPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "PAUSED">("ALL");

  async function load() {
    setLoading(true);
    try {
      if (!activeWorkspaceId) { setSchedules([]); return; }
      const token = typeof window !== "undefined" ? localStorage.getItem("vectorbea-access-token") : null;
      const res = await fetch(
        `${API_BASE}/api/schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "X-Workspace-Id": activeWorkspaceId,
          },
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      setSchedules(Array.isArray(data) ? (data as Schedule[]) : []);
    } catch {
      // API may not be wired yet — show empty state silently
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [activeWorkspaceId]);

  const filtered = schedules.filter((s) => filter === "ALL" || s.status === filter);
  const activeCount = schedules.filter((s) => s.status === "ACTIVE").length;
  const pausedCount = schedules.filter((s) => s.status === "PAUSED").length;

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Orchestration</span>
          <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.025em] text-[#0B0D0F]">Schedules</h1>
          <p className="mt-1 text-[13.5px] text-[#6B7280]">
            {loading ? "Loading…" : `${schedules.length} trigger${schedules.length !== 1 ? "s" : ""} firing workflows on a cron`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#E0E3E6] bg-white transition-colors hover:bg-[#F3F4F5] disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 text-[#6B7280]", loading && "animate-spin")} />
          </button>
          <Link
            href={"/agent-jobs/new" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1c1f22]"
          >
            <CalendarClock className="h-4 w-4" />
            New schedule
          </Link>
        </div>
      </div>

      {/* Stat tiles */}
      {schedules.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Schedules" value={schedules.length} icon={CalendarClock} />
          <StatTile label="Active" value={activeCount} accent="#007F4E" />
          <StatTile label="Paused" value={pausedCount} accent="#CA8A04" />
        </div>
      )}

      {/* Filter */}
      {schedules.length > 0 && (
        <FilterTabs
          options={[
            { value: "ALL", label: "All", count: schedules.length },
            { value: "ACTIVE", label: "Active", count: activeCount },
            { value: "PAUSED", label: "Paused", count: pausedCount },
          ]}
          value={filter}
          onChange={(v) => setFilter(v as "ALL" | "ACTIVE" | "PAUSED")}
        />
      )}

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[52px] animate-pulse rounded-[10px] border border-[#E0E3E6] bg-[#FAFBFB]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyHint
          icon={CalendarClock}
          title={schedules.length === 0 ? "No schedules yet" : "No schedules match this filter"}
          desc={schedules.length === 0
            ? "Schedules fire workflows on a recurring cron or interval. Create a job, then attach a schedule to it."
            : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid #ECEEEF", background: "#FAFBFB" }}>
                  {["Job", "Cron", "Schedule", "Timezone", "Next run", "Last run", "Status", ""].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#9CA3AF]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="group transition-colors hover:bg-[#FAFBFB]" style={{ borderTop: "1px solid #F1F2F3" }}>
                    <td className="px-5 py-3.5">
                      <Link href={`/agent-jobs/${s.jobId}` as never} className="block text-[13px] font-semibold text-[#0B0D0F] hover:text-[#007F4E]">
                        {s.jobName}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="rounded-[6px] border border-[#E0E3E6] bg-[#F3F4F5] px-1.5 py-0.5 font-mono text-[11px] text-[#4B5563]">{s.cron}</span>
                    </td>
                    <td className="px-5 py-3.5"><span className="text-[12.5px] text-[#4B5563]">{s.humanReadable}</span></td>
                    <td className="px-5 py-3.5"><span className="font-mono text-[12px] text-[#6B7280]">{s.timezone}</span></td>
                    <td className="px-5 py-3.5">
                      <span className={cn("font-mono text-[12px]", s.status === "ACTIVE" ? "text-[#0B0D0F]" : "text-[#9CA3AF]")}>{s.nextRun ?? "—"}</span>
                    </td>
                    <td className="px-5 py-3.5"><span className="font-mono text-[12px] text-[#6B7280]">{s.lastRun ?? "Never"}</span></td>
                    <td className="px-5 py-3.5">
                      {s.status === "ACTIVE"
                        ? <Chip tone="green">Active</Chip>
                        : <Chip tone="amber" dot>Paused</Chip>}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button type="button" title={s.status === "ACTIVE" ? "Pause" : "Resume"} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#6B7280] hover:bg-[#F3F4F5] hover:text-[#0B0D0F]">
                          {s.status === "ACTIVE" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </button>
                        <Link href={`/agent-jobs/${s.jobId}` as never} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#6B7280] hover:bg-[#F3F4F5] hover:text-[#0B0D0F]">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
