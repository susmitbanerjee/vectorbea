"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RunTimelineEventUi, TimelineEventType } from "@/types/agent-run-ui";
import { RunTimelineEventCard } from "./RunTimelineEventCard";

// ─── Filter groups ─────────────────────────────────────────────────────────────

type FilterGroup = "all" | "agents" | "llm" | "tools" | "http" | "approvals" | "artifacts" | "errors";

const FILTER_CONFIG: Record<FilterGroup, { label: string; types?: TimelineEventType[] }> = {
  all: { label: "All" },
  agents: { label: "Agents", types: ["AGENT_SELECTED", "AGENT_STARTED", "AGENT_COMPLETED", "AGENT_FAILED"] },
  llm: { label: "LLM", types: ["LLM_CALL_STARTED", "LLM_CALL_COMPLETED", "LLM_CALL_FAILED"] },
  tools: { label: "Tools", types: ["TOOL_CALL_STARTED", "TOOL_CALL_COMPLETED", "TOOL_CALL_FAILED"] },
  http: { label: "HTTP", types: ["HTTP_CALL_STARTED", "HTTP_CALL_COMPLETED", "HTTP_CALL_FAILED"] },
  approvals: { label: "Approvals", types: ["APPROVAL_REQUESTED", "APPROVAL_APPROVED", "APPROVAL_REJECTED", "APPROVAL_EXPIRED", "RUN_PAUSED", "RUN_RESUMED"] },
  artifacts: { label: "Artifacts", types: ["ARTIFACT_CREATED"] },
  errors: { label: "Errors" }, // special: filter by status
};

// ─── Component ─────────────────────────────────────────────────────────────────

interface RunExecutionTimelineProps {
  events: RunTimelineEventUi[];
  className?: string;
}

export function RunExecutionTimeline({ events, className }: RunExecutionTimelineProps) {
  const [filter, setFilter] = useState<FilterGroup>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const errorCount = useMemo(() => events.filter(e => e.status === "FAILED").length, [events]);
  const agentCount = useMemo(() => new Set(events.filter(e => e.agentName).map(e => e.agentName)).size, [events]);

  const filtered = useMemo(() => {
    if (filter === "errors") return events.filter(e => e.status === "FAILED");
    const cfg = FILTER_CONFIG[filter];
    if (!cfg.types) return events;
    return events.filter(e => cfg.types!.includes(e.type));
  }, [events, filter]);

  return (
    <div className={cn("space-y-3", className)}>
      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{filtered.length}</span>
            {filtered.length !== events.length && <span className="text-muted-foreground/60"> of {events.length}</span>}
            {" "}events
          </span>
          {agentCount > 0 && (
            <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
              {agentCount} agent{agentCount !== 1 ? "s" : ""}
            </span>
          )}
          {errorCount > 0 && (
            <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
              {errorCount} error{errorCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setShowFilters(f => !f)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filter
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpandAll(e => !e)}>
            {expandAll ? "Collapse all" : "Expand all"}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={() => setCollapsed(c => !c)}>
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* ── Filter chips ──────────────────────────────────────────────── */}
      {showFilters && (
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
          {(Object.entries(FILTER_CONFIG) as [FilterGroup, typeof FILTER_CONFIG[FilterGroup]][]).map(([key, cfg]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                filter === key
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {cfg.label}
              {key === "errors" && errorCount > 0 && (
                <span className="ml-1 text-red-500">({errorCount})</span>
              )}
            </button>
          ))}
          {filter !== "all" && (
            <button type="button" onClick={() => setFilter("all")} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <XCircle className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
      )}

      {/* ── Event stream ──────────────────────────────────────────────── */}
      {!collapsed ? (
        <div className="pl-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">No events match the current filter.</p>
            </div>
          ) : (
            filtered.map((event, i) => {
              const prev = filtered[i - 1];
              const showDate = i === 0 || (prev && new Date(event.timestamp).toDateString() !== new Date(prev.timestamp).toDateString());
              return (
                <RunTimelineEventCard
                  key={event.id}
                  event={event}
                  isLast={i === filtered.length - 1}
                  defaultExpanded={expandAll}
                  showDate={!!showDate}
                />
              );
            })
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex w-full items-center justify-center rounded-lg border border-dashed border-border/50 py-6 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Show {filtered.length} events
        </button>
      )}
    </div>
  );
}
