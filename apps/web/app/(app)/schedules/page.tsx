"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, Pause, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ─── Mock data ────────────────────────────────────────────────────────────────

interface Schedule {
  id: string;
  jobName: string;
  cron: string;
  humanReadable: string;
  timezone: string;
  nextRun: string;
  lastRun: string | null;
  status: "ACTIVE" | "PAUSED";
  jobId: string;
}

const MOCK_SCHEDULES: Schedule[] = [
  {
    id: "sch_001",
    jobName: "Customer Renewal Intelligence",
    cron: "0 2 * * 1",
    humanReadable: "Weekly — Mondays at 2:00 AM",
    timezone: "UTC",
    nextRun: "Mon, 26 May · 2:00 AM UTC",
    lastRun: "Mon, 19 May · 2:00 AM UTC",
    status: "ACTIVE",
    jobId: "job_001",
  },
  {
    id: "sch_002",
    jobName: "Payment Recovery Sweep",
    cron: "0 */4 * * *",
    humanReadable: "Every 4 hours",
    timezone: "UTC",
    nextRun: "Today · in 2h 14m",
    lastRun: "Today · 4:00 AM UTC",
    status: "ACTIVE",
    jobId: "job_002",
  },
  {
    id: "sch_003",
    jobName: "Contract Compliance Review",
    cron: "0 9 * * 1-5",
    humanReadable: "Weekdays at 9:00 AM",
    timezone: "UTC",
    nextRun: "—",
    lastRun: "Fri, 16 May · 9:00 AM UTC",
    status: "PAUSED",
    jobId: "job_003",
  },
  {
    id: "sch_004",
    jobName: "Data Quality Audit",
    cron: "30 8 * * *",
    humanReadable: "Daily at 8:30 AM",
    timezone: "UTC",
    nextRun: "Tomorrow · 8:30 AM UTC",
    lastRun: "Today · 8:30 AM UTC",
    status: "ACTIVE",
    jobId: "job_004",
  },
  {
    id: "sch_005",
    jobName: "SLA Breach Detector",
    cron: "*/15 * * * *",
    humanReadable: "Every 15 minutes",
    timezone: "UTC",
    nextRun: "Today · in 7m",
    lastRun: "Today · just now",
    status: "ACTIVE",
    jobId: "job_005",
  },
];

// ─── Filter chip ─────────────────────────────────────────────────────────────

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-full border px-3 text-[11px] font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SchedulesPage() {
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "PAUSED">("ALL");

  const filtered = MOCK_SCHEDULES.filter((s) => {
    if (filter === "ALL") return true;
    return s.status === filter;
  });

  const activeCount = MOCK_SCHEDULES.filter((s) => s.status === "ACTIVE").length;
  const pausedCount = MOCK_SCHEDULES.filter((s) => s.status === "PAUSED").length;

  return (
    <div className="p-7 lg:p-8 max-w-[1320px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Schedules</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Upcoming and recurring agent job triggers.
          </p>
        </div>
        <Link
          href={"/agent-jobs/new" as never}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
        >
          <CalendarClock className="h-3.5 w-3.5" />
          New Schedule
        </Link>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-[12px] text-muted-foreground">
        <span><span className="font-semibold text-foreground">{MOCK_SCHEDULES.length}</span> schedules configured</span>
        <span className="text-border">·</span>
        <span><span className="font-semibold text-emerald-600">{activeCount}</span> active</span>
        <span className="text-border">·</span>
        <span><span className="font-semibold text-amber-600">{pausedCount}</span> paused</span>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1.5">
        {(["ALL", "ACTIVE", "PAUSED"] as const).map((f) => (
          <FilterChip
            key={f}
            label={f === "ALL" ? "All" : f === "ACTIVE" ? "Active" : "Paused"}
            active={filter === f}
            onClick={() => setFilter(f)}
          />
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <CalendarClock className="h-8 w-8 text-muted-foreground/20" />
              <p className="text-sm font-medium text-muted-foreground">No schedules match this filter</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Job Name", "Cron", "Schedule", "Timezone", "Next Run", "Last Run", "Status", ""].map((h) => (
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
                  {filtered.map((s) => (
                    <tr key={s.id} className="group transition-colors hover:bg-muted/20">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/agent-jobs/${s.jobId}` as never}
                          className="block text-[13px] font-medium hover:underline"
                        >
                          {s.jobName}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-[11px] text-muted-foreground">{s.cron}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-[12px] text-muted-foreground">{s.humanReadable}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-[12px] text-muted-foreground">{s.timezone}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn(
                          "text-[12px]",
                          s.status === "ACTIVE" ? "text-foreground" : "text-muted-foreground/50",
                        )}>
                          {s.nextRun}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-[12px] text-muted-foreground">{s.lastRun ?? "Never"}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {s.status === "ACTIVE" ? (
                          <Badge className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Active
                          </Badge>
                        ) : (
                          <Badge className="gap-1 border-amber-200 bg-amber-50 text-amber-700 text-[10px]">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                            Paused
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            title={s.status === "ACTIVE" ? "Pause" : "Resume"}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {s.status === "ACTIVE" ? (
                              <Pause className="h-3 w-3" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                          </button>
                          <Link
                            href={`/agent-jobs/${s.jobId}` as never}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
