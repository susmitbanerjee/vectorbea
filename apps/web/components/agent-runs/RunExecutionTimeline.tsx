"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RunTimelineEvent, RunTimelineEventType } from "@/lib/run-timeline";
import { RunTimelineEventCard } from "./RunTimelineEventCard";

// ─── Filter groups ────────────────────────────────────────────────────────────

type FilterGroup = "all" | "system" | "llm" | "tool" | "approval" | "errors";

const FILTER_LABELS: Record<FilterGroup, string> = {
  all: "All",
  system: "System",
  llm: "LLM",
  tool: "Tool",
  approval: "Approval",
  errors: "Errors only",
};

const FILTER_TYPES: Record<FilterGroup, RunTimelineEventType[] | null> = {
  all: null,
  system: [
    "RUN_CREATED", "RUN_QUEUED", "RUN_STARTED", "RUN_SUCCEEDED",
    "RUN_FAILED", "RUN_CANCELLED", "RUN_TIMEOUT", "RUN_RESUMED",
    "BUDGET_CHECK_PASSED", "BUDGET_CHECK_FAILED", "POLICY_CHECK_PASSED", "POLICY_CHECK_FAILED",
    "RETRY_QUEUED", "RETRY_STARTED",
  ],
  llm: ["LLM_CALL_STARTED", "LLM_CALL_SUCCEEDED", "LLM_CALL_FAILED"],
  tool: ["TOOL_CALL_STARTED", "TOOL_CALL_SUCCEEDED", "TOOL_CALL_FAILED", "STEP_STARTED", "STEP_SUCCEEDED", "STEP_FAILED", "STEP_SKIPPED"],
  approval: ["APPROVAL_PAUSED", "APPROVAL_REQUESTED", "APPROVAL_APPROVED", "APPROVAL_REJECTED", "APPROVAL_EXPIRED"],
  errors: null, // special — filter by status
};

// ─── Component ────────────────────────────────────────────────────────────────

interface RunExecutionTimelineProps {
  events: RunTimelineEvent[];
  className?: string;
}

export function RunExecutionTimeline({ events, className }: RunExecutionTimelineProps) {
  const [filter, setFilter] = useState<FilterGroup>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Apply filter
  const filtered = events.filter((e) => {
    if (filter === "errors") return e.status === "FAILED";
    const types = FILTER_TYPES[filter];
    if (!types) return true;
    return types.includes(e.type);
  });

  const errorCount = events.filter((e) => e.status === "FAILED").length;

  return (
    <div className={cn("space-y-3", className)}>
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {events.length} events
          </span>
          {errorCount > 0 && (
            <span className="inline-flex items-center rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-600">
              {errorCount} error{errorCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => setShowFilters((f) => !f)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filter
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? (
              <><ChevronDown className="h-3.5 w-3.5" />Expand</>
            ) : (
              <><ChevronUp className="h-3.5 w-3.5" />Collapse</>
            )}
          </Button>
        </div>
      </div>

      {/* ── Filter chips ─────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-3">
          {(Object.keys(FILTER_LABELS) as FilterGroup[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setFilter(g)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                filter === g
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-border/80",
              )}
            >
              {FILTER_LABELS[g]}
              {g === "errors" && errorCount > 0 && (
                <span className="ml-1 text-red-500">({errorCount})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Event stream ─────────────────────────────────────────────────── */}
      {!collapsed && (
        <div className="pl-1">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              No events match the current filter.
            </div>
          ) : (
            filtered.map((event, i) => {
              const prev = filtered[i - 1];
              const showDate =
                i === 0 ||
                (prev &&
                  new Date(event.timestamp).toDateString() !==
                    new Date(prev.timestamp).toDateString());

              return (
                <RunTimelineEventCard
                  key={event.id}
                  event={event}
                  isLast={i === filtered.length - 1}
                  showDate={showDate}
                />
              );
            })
          )}
        </div>
      )}

      {collapsed && (
        <div className="flex items-center justify-center py-6 rounded-lg border border-dashed border-border/60">
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setCollapsed(false)}
          >
            Show {filtered.length} events
          </button>
        </div>
      )}
    </div>
  );
}
