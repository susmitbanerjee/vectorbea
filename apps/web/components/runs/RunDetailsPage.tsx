"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { WorkflowRun, ViewMode, RunStep } from "@/types/runs";
import { RunSummaryHeader } from "./RunSummaryHeader";
import { RunViewToggle } from "./RunViewToggle";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { StepDetailsPanel } from "./StepDetailsPanel";
import { LogsTab } from "./tabs/LogsTab";
import { ToolCallsTab } from "./tabs/ToolCallsTab";
import { ApprovalsTab } from "./tabs/ApprovalsTab";
import { EventHistoryTab } from "./tabs/EventHistoryTab";
import { InputsOutputsTab } from "./tabs/InputsOutputsTab";
import { RecoveryTab } from "./tabs/RecoveryTab";
import { cn } from "@/lib/utils";

type TabId = "logs" | "inputs_outputs" | "tool_calls" | "approvals" | "events" | "recovery";

const BUSINESS_TABS: { id: TabId; label: string }[] = [
  { id: "logs",          label: "Activity" },
  { id: "approvals",     label: "Approvals" },
  { id: "inputs_outputs",label: "Outputs" },
  { id: "recovery",      label: "Recovery" },
];

const ENGINEERING_TABS: { id: TabId; label: string }[] = [
  { id: "logs",          label: "Logs" },
  { id: "inputs_outputs",label: "Inputs & Outputs" },
  { id: "tool_calls",    label: "Tool Calls" },
  { id: "approvals",     label: "Approvals" },
  { id: "events",        label: "Event History" },
  { id: "recovery",      label: "Recovery" },
];

export function RunDetailsPage({ run }: { run: WorkflowRun }) {
  const [viewMode, setViewMode]         = useState<ViewMode>("business");
  const [selectedStepId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab]       = useState<TabId>("logs");

  const selectedStep: RunStep | undefined = run.steps.find(s => s.id === selectedStepId);
  const tabs = viewMode === "business" ? BUSINESS_TABS : ENGINEERING_TABS;

  function handleAction(action: string) {
    const messages: Record<string, string> = {
      approve:          "Approving run — connecting to API…",
      reject:           "Rejecting — connecting to API…",
      resume:           "Resuming from checkpoint — connecting to API…",
      retry:            "Retrying failed step — connecting to API…",
      retry_step:       "Retrying step — connecting to API…",
      cancel:           "Cancelling run — connecting to API…",
      continue_as_new:  "Starting continue-as-new run — connecting to API…",
      open_workflow:    "Opening workflow builder…",
    };
    toast.info(messages[action] ?? "Action will be connected to backend API.", {
      description: "Placeholder — backend integration pending.",
    });
  }

  // Badge counts for tabs
  const badgeCounts: Partial<Record<TabId, number>> = {
    approvals:  run.approvals.filter(a => a.status === "requested").length || undefined,
    tool_calls: run.toolCalls.length || undefined,
    events:     run.events.length || undefined,
  };

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <RunSummaryHeader run={run} viewMode={viewMode} onAction={handleAction} />

      {/* View toggle */}
      <div className="flex items-center justify-between">
        <RunViewToggle mode={viewMode} onChange={setViewMode} />
        <p style={{ fontSize: 12, color: "#94A3B8" }}>
          {viewMode === "business" ? "Simplified view — technical details hidden" : "Engineering view — full debug access"}
        </p>
      </div>

      {/* Main area: Timeline + Details */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1fr) 380px" }}>
        {/* Timeline */}
        <ExecutionTimeline
          run={run}
          selectedStepId={selectedStepId}
          onSelectStep={id => { setSelectedId(id); setActiveTab("logs"); }}
          viewMode={viewMode}
        />
        {/* Step details */}
        <StepDetailsPanel
          run={run}
          stepId={selectedStepId}
          viewMode={viewMode}
          onAction={handleAction}
        />
      </div>

      {/* Bottom tabs */}
      <div
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
        <div className="p-4 min-h-[300px]">
          {activeTab === "logs" && <LogsTab run={run} viewMode={viewMode} />}
          {activeTab === "inputs_outputs" && <InputsOutputsTab run={run} selectedStep={selectedStep} />}
          {activeTab === "tool_calls" && <ToolCallsTab run={run} />}
          {activeTab === "approvals" && <ApprovalsTab run={run} onAction={handleAction} />}
          {activeTab === "events" && <EventHistoryTab run={run} />}
          {activeTab === "recovery" && <RecoveryTab run={run} viewMode={viewMode} onAction={handleAction} />}
        </div>
      </div>
    </div>
  );
}
