"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { WorkflowRun, ViewMode, RunStep } from "@/types/runs";
import { RunSummaryHeader } from "./RunSummaryHeader";
import { RunViewToggle } from "./RunViewToggle";
import { RunTimeline } from "./RunTimeline";
import type { RunTimelineEventUi } from "@/types/agent-run-ui";
import { LogsTab } from "./tabs/LogsTab";
import { ToolCallsTab } from "./tabs/ToolCallsTab";
import { ApprovalsTab } from "./tabs/ApprovalsTab";
import { EventHistoryTab } from "./tabs/EventHistoryTab";
import { InputsOutputsTab } from "./tabs/InputsOutputsTab";
import { RecoveryTab } from "./tabs/RecoveryTab";
import { cn } from "@/lib/utils";

// Tabs: Logs | Recovery | Tool Calls | Event History (engineering)
// Removed: Activity (renamed to Logs), Approvals, Outputs
type TabId = "logs" | "recovery" | "tool_calls" | "events";

const BUSINESS_TABS: { id: TabId; label: string }[] = [
  { id: "logs",     label: "Logs" },
  { id: "recovery", label: "Recovery" },
];

const ENGINEERING_TABS: { id: TabId; label: string }[] = [
  { id: "logs",       label: "Logs" },
  { id: "recovery",   label: "Recovery" },
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
  const [viewMode, setViewMode]         = useState<ViewMode>("business");
  const [selectedEventId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<TabId>("logs");

  const tabs = viewMode === "business" ? BUSINESS_TABS : ENGINEERING_TABS;
  const timelineEvents = rawEvents ?? [];

  function handleAction(action: string) {
    if (onAction) {
      // Wire into the approval ID from the run if the action needs it
      const pendingApproval = run.approvals.find(a => a.status === "requested");
      onAction(action, pendingApproval ? { approvalId: pendingApproval.id } : undefined);
      return;
    }
    // Fallback toast when no external handler provided
    const messages: Record<string, string> = {
      approve:         "Approving run…",
      reject:          "Rejecting…",
      retry:           "Retrying failed step…",
      retry_step:      "Retrying step…",
      cancel:          "Cancelling run…",
      open_workflow:   "Opening workflow builder…",
    };
    toast.info(messages[action] ?? "Action triggered.", { description: action });
  }

  // Badge counts for tabs
  const badgeCounts: Partial<Record<TabId, number>> = {
    tool_calls: run.toolCalls.length || undefined,
    events:     run.events.length || undefined,
    logs:       run.logs.length || undefined,
  };

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <RunSummaryHeader run={run} viewMode={viewMode} onAction={handleAction} />

      {/* View toggle */}
      <div className="flex items-center justify-between">
        <RunViewToggle mode={viewMode} onChange={v => { setViewMode(v); }} />
        <p style={{ fontSize: 12, color: "#94A3B8" }}>
          {viewMode === "business" ? "Key steps — technical details hidden"
            : viewMode === "engineering" ? "Full event trace — all technical details"
            : "Raw execution logs — search and filter"}
        </p>
      </div>

      {/* ── Logs view — full-height dedicated logs panel ─────────────────── */}
      {viewMode === "logs" && (
        <div
          className="rounded-2xl bg-white overflow-hidden"
          style={{ border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(15,23,42,0.04)" }}
        >
          <div className="px-4 pt-4 pb-4 min-h-[480px]">
            <LogsTab run={run} viewMode="engineering" />
          </div>
        </div>
      )}

      {/* ── Timeline — Business or Engineering view ───────────────────────── */}
      {viewMode !== "logs" && (
        <div
          className="rounded-2xl overflow-hidden bg-white"
          style={{ border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(15,23,42,0.04)" }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>
              {viewMode === "business" ? "Execution Summary" : "Event Timeline"}
            </span>
            <span style={{ fontSize: 11.5, color: "#94A3B8" }}>
              {viewMode === "business" ? "Key steps only" : `${timelineEvents.length} events`}
            </span>
          </div>
          <RunTimeline
            events={timelineEvents}
            variant={viewMode}
            selectedId={selectedEventId ?? undefined}
            onSelect={id => { setSelectedId(id); setActiveTab("logs"); }}
            isLive={isLive}
          />
        </div>
      )}

      {/* Bottom tabs — hidden when Logs view is active (logs view has its own full-height panel above) */}
      {viewMode !== "logs" && <div
        className="rounded-2xl bg-white overflow-hidden"
        style={{ border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(15,23,42,0.04)" }}
      >
        {/* Tab bar */}
        <div className="flex items-center border-b border-slate-200 overflow-x-auto" style={{ background: "#F8FAFC" }}>
          {tabs.map(tab => {
            const badge = badgeCounts[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-4 text-[13px] font-semibold transition-colors",
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-700"
                    : "border-transparent text-slate-500 hover:text-slate-700",
                )}
              >
                {tab.label}
                {badge != null && badge > 0 && (
                  <span
                    className="rounded-full px-1.5 py-px text-[10px] font-bold"
                    style={activeTab === tab.id
                      ? { background: "#DBEAFE", color: "#1D4ED8" }
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
        <div className={activeTab === "logs" ? "" : "p-4 min-h-[300px]"}>
          {activeTab === "logs"       && <LogsTab run={run} viewMode={viewMode} rawEvents={rawEvents} />}
          {activeTab === "recovery"   && <RecoveryTab run={run} viewMode={viewMode} onAction={handleAction} />}
          {activeTab === "tool_calls" && <ToolCallsTab run={run} />}
          {activeTab === "events"     && <EventHistoryTab run={run} />}
        </div>
      </div>}
    </div>
  );
}
