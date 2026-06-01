"use client";

/**
 * RunsHealthBar — Temporal-style health summary strip for the Runs list.
 *
 * Shows: total · running (live) · succeeded · failed · waiting · success-rate.
 * Fetches status counts in parallel; list page still renders immediately.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getRuns } from "@/lib/repository";

interface Counts {
  total: number;
  running: number;
  succeeded: number;
  failed: number;
  waiting: number;
  queued: number;
}

async function fetchCounts(): Promise<Counts> {
  const [allRes, runningRes, succeededRes, failedRes, waitingRes, queuedRes] =
    await Promise.all([
      getRuns({ pageSize: 1 }),
      getRuns({ status: "running",              pageSize: 1 }),
      getRuns({ status: "succeeded",            pageSize: 1 }),
      getRuns({ status: "failed",               pageSize: 1 }),
      getRuns({ status: "waiting_for_approval", pageSize: 1 }),
      getRuns({ status: "queued",               pageSize: 1 }),
    ]);
  return {
    total:     allRes.total,
    running:   runningRes.total,
    succeeded: succeededRes.total,
    failed:    failedRes.total,
    waiting:   waitingRes.total,
    queued:    queuedRes.total,
  };
}

function SkeletonPill({ w = 80 }: { w?: number }) {
  return (
    <div className="h-[38px] animate-pulse rounded-xl bg-[#E5E7EB]" style={{ width: w }} />
  );
}

interface StatPillProps {
  label: string;
  value: number;
  dot?: string;
  dotPulse?: boolean;
  valueClass?: string;
  hide?: boolean;
}

function StatPill({ label, value, dot, dotPulse, valueClass, hide }: StatPillProps) {
  if (hide) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      {dot && (
        <span className={cn("h-2 w-2 shrink-0 rounded-full", dot, dotPulse && "animate-pulse")} />
      )}
      <span className={cn("tabular-nums text-[14px] font-bold", valueClass ?? "text-[#111827]")}>
        {value.toLocaleString()}
      </span>
      <span className="text-[13px] font-medium text-[#6B7280]">{label}</span>
    </div>
  );
}

export function RunsHealthBar() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCounts()
      .then(setCounts)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <SkeletonPill w={96} /><SkeletonPill w={88} /><SkeletonPill w={88} /><SkeletonPill w={88} /><SkeletonPill w={72} />
      </div>
    );
  }

  if (!counts) return null;

  const successRate =
    counts.succeeded + counts.failed > 0
      ? Math.round((counts.succeeded / (counts.succeeded + counts.failed)) * 100)
      : null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatPill label="total" value={counts.total} />
      <div className="h-5 w-px bg-[#E5E7EB]" />
      <StatPill label="running"   value={counts.running}   dot="bg-blue-500"    dotPulse valueClass="text-[#1D4ED8]" />
      <StatPill label="queued"    value={counts.queued}    dot="bg-slate-400"   hide={counts.queued === 0} />
      <StatPill label="waiting"   value={counts.waiting}   dot="bg-amber-500"   dotPulse valueClass="text-amber-700" hide={counts.waiting === 0} />
      <StatPill label="succeeded" value={counts.succeeded} dot="bg-emerald-500" valueClass="text-emerald-700" />
      <StatPill label="failed"    value={counts.failed}    dot="bg-red-500"     valueClass="text-red-700" />
      {successRate !== null && (
        <>
          <div className="h-5 w-px bg-[#E5E7EB]" />
          <div className={cn(
            "inline-flex items-center rounded-xl border px-4 py-2 text-[13px] font-semibold shadow-[0_1px_3px_rgba(0,0,0,0.05)]",
            successRate >= 95 ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : successRate >= 80 ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-red-200 bg-red-50 text-red-700",
          )}>
            {successRate}% success rate
          </div>
        </>
      )}
    </div>
  );
}
