"use client";
import { useState } from "react";
import type { WorkflowRun, RunStep, ViewMode } from "@/types/runs";
import { StatusBadge } from "./StatusBadge";
import { StepTypeIcon } from "./StepTypeIcon";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";

function fmtMs(ms: number | undefined): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Group parallel steps
function groupSteps(steps: RunStep[]): (RunStep | RunStep[])[] {
  const groups: (RunStep | RunStep[])[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) continue;
    seen.add(step.id);
    if (step.parallelGroupId) {
      const siblings = steps.filter(s => s.parallelGroupId === step.parallelGroupId && !seen.has(s.id));
      siblings.forEach(s => seen.add(s.id));
      groups.push([step, ...siblings]);
    } else {
      groups.push(step);
    }
  }
  return groups;
}

function TimelineRow({
  step, maxDurationMs, totalDurationMs, selected, onClick, viewMode,
}: {
  step: RunStep; maxDurationMs: number; totalDurationMs: number;
  selected: boolean; onClick: () => void; viewMode: ViewMode;
}) {
  const barWidth = step.durationMs
    ? Math.max(2, (step.durationMs / Math.max(maxDurationMs, 1)) * 100)
    : 0;
  const barOffset = step.offsetMs
    ? (step.offsetMs / Math.max(totalDurationMs, 1)) * 100
    : 0;

  const barColorMap: Record<string,string> = {
    completed: "#10B981", failed: "#EF4444", running: "#2563EB",
    waiting_for_approval: "#D97706", waiting: "#D97706", retrying: "#EA580C", queued: "#CBD5E1", skipped: "#CBD5E1", cancelled: "#CBD5E1", timed_out: "#EF4444", budget_exceeded: "#EF4444", rate_limited: "#EA580C", self_correcting: "#7C3AED", waiting_for_signal: "#D97706",
  };
  const barColor = barColorMap[step.status] ?? "#CBD5E1";

  const name = viewMode === "business" ? step.businessName : step.name;
  const isWaiting = step.status === "waiting_for_approval" || step.status === "waiting";

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-4 cursor-pointer transition-colors border-b border-slate-100",
        selected ? "bg-blue-50" : "hover:bg-slate-50/80",
      )}
      style={{ minHeight: 52 }}
    >
      {/* Icon */}
      <StepTypeIcon type={step.type} size={28} />

      {/* Name + badges */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontSize: 13, fontWeight: selected ? 700 : 600, color: selected ? "#1D4ED8" : "#0F172A" }}>
            {name}
          </span>
          {viewMode === "engineering" && (
            <span
              className="rounded border px-1.5 py-px font-mono"
              style={{ fontSize: 9, color: "#94A3B8", borderColor: "#E2E8F0", background: "#F8FAFC" }}
            >
              {step.type}
            </span>
          )}
          {step.attemptCount > 1 && (
            <span className="flex items-center gap-1 rounded border border-orange-200 bg-orange-50 px-1.5 py-px" style={{ fontSize: 10, color: "#C2410C" }}>
              <RotateCcw className="h-2.5 w-2.5" />
              {step.attemptCount} attempts
            </span>
          )}
        </div>
        {viewMode === "engineering" && step.model && (
          <span style={{ fontSize: 11, color: "#94A3B8" }}>{step.model}</span>
        )}
      </div>

      {/* Waterfall bar */}
      <div className="relative flex-1 min-w-[120px] max-w-[260px] h-5">
        <div className="absolute inset-y-0 w-full rounded-full" style={{ background: "#F1F5F9" }}>
          {step.status === "queued" || !step.durationMs ? (
            <div className="absolute inset-y-0 rounded-full" style={{ left: `${barOffset}%`, width: 8, background: "#CBD5E1" }} />
          ) : (
            <div
              className={cn("absolute inset-y-0 rounded-full", isWaiting && "animate-pulse")}
              style={{
                left: `${Math.min(barOffset, 90)}%`,
                width: `${Math.max(barWidth, 2)}%`,
                background: barColor,
                opacity: 0.85,
              }}
            />
          )}
        </div>
      </div>

      {/* Duration + cost */}
      <div className="flex items-center gap-3 shrink-0 w-32 justify-end">
        <span style={{ fontSize: 12, color: "#64748B", fontVariantNumeric: "tabular-nums" }}>
          {fmtMs(step.durationMs)}
        </span>
        {viewMode === "engineering" && step.costUsd != null && step.costUsd > 0 && (
          <span style={{ fontSize: 11, color: "#94A3B8" }}>${step.costUsd.toFixed(3)}</span>
        )}
        <StatusBadge status={step.status} size="xs" />
      </div>

      <ChevronRight className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", selected && "rotate-90 text-blue-500")} />
    </div>
  );
}

export function ExecutionTimeline({
  run, selectedStepId, onSelectStep, viewMode,
}: {
  run: WorkflowRun; selectedStepId: string | null;
  onSelectStep: (stepId: string) => void; viewMode: ViewMode;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const grouped = groupSteps(run.steps);
  const totalDurationMs = run.durationMs || 1;
  const maxStepDuration = Math.max(...run.steps.map(s => s.durationMs ?? 0), 1);

  function toggleGroup(groupId: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }

  return (
    <div
      className="rounded-2xl bg-white overflow-hidden"
      style={{ border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(15,23,42,0.04)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em" }}>
          Execution Timeline
        </span>
        <div className="flex items-center gap-4" style={{ fontSize: 11, color: "#94A3B8" }}>
          <span>{run.steps.length} steps</span>
          <span>{(run.durationMs / 1000).toFixed(0)}s total</span>
        </div>
      </div>

      {/* Timeline rows */}
      <div>
        {grouped.map((item, idx) => {
          if (Array.isArray(item)) {
            // Parallel group
            const groupId = item[0].parallelGroupId ?? `pg_${idx}`;
            const isExpanded = expandedGroups.has(groupId);
            return (
              <div key={groupId}>
                <button
                  type="button"
                  onClick={() => toggleGroup(groupId)}
                  className="flex w-full items-center gap-2 px-4 py-2 hover:bg-slate-50 transition-colors border-b border-slate-100"
                  style={{ background: "#FAFBFF" }}
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#0891B2", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Parallel — {item.length} branches
                  </span>
                  <span style={{ fontSize: 11, color: "#94A3B8" }}>
                    running concurrently
                  </span>
                </button>
                {isExpanded && item.map(step => (
                  <div key={step.id} className="pl-4">
                    <TimelineRow
                      step={step} maxDurationMs={maxStepDuration}
                      totalDurationMs={totalDurationMs}
                      selected={selectedStepId === step.id}
                      onClick={() => onSelectStep(step.id)}
                      viewMode={viewMode}
                    />
                  </div>
                ))}
                {!isExpanded && (
                  <div className="flex pl-8 gap-2 py-2 border-b border-slate-100 flex-wrap">
                    {item.map(step => (
                      <span
                        key={step.id}
                        onClick={() => { toggleGroup(groupId); onSelectStep(step.id); }}
                        className="cursor-pointer rounded-lg border px-2.5 py-1 text-[12px] font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                        style={{ borderColor: "#E2E8F0" }}
                      >
                        {viewMode === "business" ? step.businessName : step.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <TimelineRow
              key={item.id} step={item} maxDurationMs={maxStepDuration}
              totalDurationMs={totalDurationMs}
              selected={selectedStepId === item.id}
              onClick={() => onSelectStep(item.id)}
              viewMode={viewMode}
            />
          );
        })}
      </div>
    </div>
  );
}
