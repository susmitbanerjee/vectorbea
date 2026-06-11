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
        style={{ border: "1px solid #E0E3E6", boxShadow: "0 2px 8px rgba(11,13,15,0.04)" }}
      >
        {/* Tab bar */}
        <div className="flex items-center overflow-x-auto border-b border-[#E0E3E6]" style={{ background: "#FAFBFB" }}>
          {TABS.map(tab => {
            const badge = badgeCounts[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-4 text-[13px] transition-colors",
                  activeTab === tab.id
                    ? "border-[#007F4E] font-semibold text-[#006B45]"
                    : "border-transparent font-medium text-[#6B7280] hover:text-[#0B0D0F]",
                )}
              >
                {tab.label}
                {badge != null && badge > 0 && (
                  <span
                    className="rounded-full px-1.5 py-px font-mono text-[10px] font-semibold tabular-nums"
                    style={activeTab === tab.id
                      ? { background: "#E6F4EF", color: "#006B45" }
                      : { background: "#F3F4F5", color: "#6B7280" }}
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
              <div className="flex items-center justify-between border-b border-[#ECEEEF] px-4 py-3">
                <span className="text-[13.5px] font-bold tracking-[-0.01em] text-[#0B0D0F]">Event Timeline</span>
                <span className="font-mono text-[11px] tabular-nums text-[#9CA3AF]">{timelineEvents.length} events</span>
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
