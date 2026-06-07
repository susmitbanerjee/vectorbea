"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { WorkflowRun, RunStep } from "@/types/runs";
import { RunSummaryHeader } from "./RunSummaryHeader";
import { RunTimeline } from "./RunTimeline";
import type { RunTimelineEventUi } from "@/types/agent-run-ui";
import { LogsTab } from "./tabs/LogsTab";
import { ToolCallsTab } from "./tabs/ToolCallsTab";
import { EventHistoryTab } from "./tabs/EventHistoryTab";
import { RecoveryTab } from "./tabs/RecoveryTab";
import { cn } from "@/lib/utils";

// Single tab bar: Execution View (timeline) plus Logs / Tool Calls / Recovery / Events
type TabId = "execution" | "logs" | "recovery" | "tool_calls" | "events";

const TABS: { id: TabId; label: string }[] = [
  { id: "execution",  label: "Execution View" },
  { id: "logs",       label: "Logs" },
  { id: "recovery",   label: "Recovery Engine" },
  { id: "tool_calls", label: "Tool Calls" },
  { id: "events",     label: "Event History" },
];

export function RunDetailsPage({
  run,
  onAction,
  rawEvents,
  isLive,
}: {
  run: WorkflowRun;
  onAction?: (action: string, payload?: Record<string, string>) => void;
  rawEvents?: RunTimelineEventUi[];
  isLive?: boolean;
}) {
  const [selectedEventId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab]        = useState<TabId>("execution");

  const timelineEvents = rawEvents ?? [];

  function handleAction(action: string) {
    if (onAction) {
      const pendingApproval = run.approvals.find(a => a.status === "requested");
      onAction(action, pendingApproval ? { approvalId: pendingApproval.id } : undefined);
      return;
    }
    const messages: Record<string, string> = {
      approve:       "Approving run…",
      reject:        "Rejecting…",
      retry:         "Retrying failed step…",
      retry_step:    "Retrying step…",
      cancel:        "Cancelling run…",
      open_workflow: "Opening workflow builder…",
    };
    toast.info(messages[action] ?? "Action triggered.", { description: action });
  }

  const badgeCounts: Partial<Record<TabId, number>> = {
    tool_calls: run.toolCalls.length || undefined,
    events:     run.events.length    || undefined,
    logs:       run.logs.length      || undefined,
  };

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <RunSummaryHeader run={run} viewMode="engineering" onAction={handleAction} />

      {/* ── Execution View / Logs / Recovery / Tool Calls / Events tabs ───── */}
      <div
        className="rounded-2xl bg-white overflow-hidden"
        style={{ border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(15,23,42,0.04)" }}
      >
        {/* Tab bar */}
        <div className="flex items-center border-b border-slate-200 overflow-x-auto" style={{ background: "#F8FAFC" }}>
          {TABS.map(tab => {
            const badge = badgeCounts[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-4 text-[13px] font-semibold transition-colors",
                  activeTab === tab.id
                    ? "border-amber-500 text-amber-700"
                    : "border-transparent text-slate-500 hover:text-slate-700",
                )}
              >
                {tab.label}
                {badge != null && badge > 0 && (
                  <span
                    className="rounded-full px-1.5 py-px text-[10px] font-bold"
                    style={activeTab === tab.id
                      ? { background: "#FEF3C7", color: "#B45309" }
                      : { background: "#F1F5F9", color: "#64748B" }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className={activeTab === "logs" || activeTab === "execution" ? "" : "p-4 min-h-[300px]"}>
          {activeTab === "execution" && (
            <div>
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>Event Timeline</span>
                <span style={{ fontSize: 11.5, color: "#94A3B8" }}>{timelineEvents.length} events</span>
              </div>
              <RunTimeline
                events={timelineEvents}
                variant="engineering"
                selectedId={selectedEventId ?? undefined}
                onSelect={id => { setSelectedId(id); setActiveTab("logs"); }}
                isLive={isLive}
              />
            </div>
          )}
          {activeTab === "logs"       && <LogsTab run={run} viewMode="engineering" rawEvents={rawEvents} />}
          {activeTab === "recovery"   && <RecoveryTab run={run} viewMode="engineering" onAction={handleAction} />}
          {activeTab === "tool_calls" && <ToolCallsTab run={run} />}
          {activeTab === "events"     && <EventHistoryTab run={run} />}
        </div>
      </div>
    </div>
  );
}
