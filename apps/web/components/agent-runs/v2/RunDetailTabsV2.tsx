"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeftRight, Bot, Braces, FileCode2, GitBranch, History,
  ScrollText, ShieldCheck, TableProperties,
} from "lucide-react";
import type { AgentRunUiModel } from "@/types/agent-run-ui";
import { RunExecutionTimeline } from "./RunExecutionTimeline";
import { AgentsTab } from "./tabs/AgentsTab";
import { ApprovalsTab } from "./tabs/ApprovalsTab";
import { ArtifactsTab } from "./tabs/ArtifactsTab";
import { FlowTab } from "./tabs/FlowTab";
import { EventHistoryTab } from "./tabs/EventHistoryTab";
import { MetadataTab } from "./tabs/MetadataTab";
import { InputOutputTab } from "./tabs/InputOutputTab";
import { RawTab } from "./tabs/RawTab";

interface RunDetailTabsV2Props {
  model: AgentRunUiModel;
  defaultTab?: string;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
}

export function RunDetailTabsV2({ model, defaultTab = "timeline", onApprove, onReject }: RunDetailTabsV2Props) {
  const { run, agents, timelineEvents, approvals, artifacts } = model;
  const errorCount = timelineEvents.filter(e => e.status === "FAILED").length;
  const pendingApprovals = approvals.filter(a => a.status === "PENDING").length;

  return (
    <Tabs defaultValue={defaultTab} className="space-y-0">
      {/* Tab bar — light mode, underline indicator */}
      <div
        className="sticky top-0 z-10"
        style={{ background: "#FFFFFF", borderBottom: "1px solid #E2E8F0" }}
      >
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-0 bg-transparent p-0 px-1 gap-0 flex-nowrap">
          <TabTrigger value="timeline" icon={<History className="h-3.5 w-3.5" />} label="Timeline">
            <TabBadge count={timelineEvents.length} />
            {errorCount > 0 && <TabErrorBadge>{errorCount} error{errorCount !== 1 ? "s" : ""}</TabErrorBadge>}
          </TabTrigger>
          <TabTrigger value="flow" icon={<GitBranch className="h-3.5 w-3.5" />} label="Flow">
            <TabBadge count={agents.length} />
          </TabTrigger>
          <TabTrigger value="events" icon={<TableProperties className="h-3.5 w-3.5" />} label="Events">
            <TabBadge count={timelineEvents.length} />
          </TabTrigger>
          <TabTrigger value="agents" icon={<Bot className="h-3.5 w-3.5" />} label="Agents">
            <TabBadge count={agents.length} />
          </TabTrigger>
          <TabTrigger value="approvals" icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Approvals">
            {pendingApprovals > 0
              ? <TabWarnBadge>{pendingApprovals} pending</TabWarnBadge>
              : approvals.length > 0 ? <TabBadge count={approvals.length} /> : null
            }
          </TabTrigger>
          <TabTrigger value="io" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Input / Output" />
          <TabTrigger value="artifacts" icon={<FileCode2 className="h-3.5 w-3.5" />} label="Artifacts">
            {artifacts.length > 0 && <TabBadge count={artifacts.length} />}
          </TabTrigger>
          <TabTrigger value="metadata" icon={<Braces className="h-3.5 w-3.5" />} label="Metadata" />
          <TabTrigger value="raw" icon={<ScrollText className="h-3.5 w-3.5" />} label="Raw" />
        </TabsList>
      </div>

      {/* Tab content */}
      <div>
        <TabsContent value="timeline" className="mt-0">
          <RunExecutionTimeline events={timelineEvents} />
        </TabsContent>
        <TabsContent value="flow" className="mt-0">
          <FlowTab agents={agents} timelineEvents={timelineEvents} />
        </TabsContent>
        <TabsContent value="events" className="mt-0">
          <EventHistoryTab events={timelineEvents} />
        </TabsContent>
        <TabsContent value="agents" className="mt-0">
          <AgentsTab agents={agents} />
        </TabsContent>
        <TabsContent value="approvals" className="mt-0">
          <ApprovalsTab approvals={approvals} onApprove={onApprove} onReject={onReject} />
        </TabsContent>
        <TabsContent value="io" className="mt-0">
          <InputOutputTab
            input={model.input}
            output={model.output}
            partialOutput={model.partialOutput}
            errorMessage={run.errorMessage}
            isFailed={run.status === "FAILED"}
          />
        </TabsContent>
        <TabsContent value="artifacts" className="mt-0">
          <ArtifactsTab artifacts={artifacts} />
        </TabsContent>
        <TabsContent value="metadata" className="mt-0">
          <MetadataTab model={model} />
        </TabsContent>
        <TabsContent value="raw" className="mt-0">
          <RawTab model={model} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

// ─── Tab trigger — light underline style ─────────────────────────────────────

function TabTrigger({ value, icon, label, children }: {
  value: string; icon: React.ReactNode; label: string; children?: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      className={[
        "relative flex shrink-0 items-center gap-1.5 px-3.5 py-3 text-[13px] font-medium whitespace-nowrap",
        "text-slate-500 hover:text-slate-800 rounded-none border-b-2 border-transparent",
        "transition-colors duration-150",
        "data-[state=active]:text-blue-700 data-[state=active]:border-blue-600 data-[state=active]:font-semibold",
        "data-[state=active]:bg-transparent data-[state=active]:shadow-none",
        "focus-visible:outline-none",
      ].join(" ")}
    >
      {icon}
      {label}
      {children}
    </TabsTrigger>
  );
}

function TabBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-1.5 rounded-full px-1.5 py-px text-[10.5px] font-semibold tabular-nums bg-slate-100 text-slate-500">
      {count}
    </span>
  );
}

function TabErrorBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 rounded-full bg-red-100 border border-red-200 px-1.5 py-px text-[10.5px] font-semibold tabular-nums text-red-700">
      {children}
    </span>
  );
}

function TabWarnBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 rounded-full bg-amber-100 border border-amber-200 px-1.5 py-px text-[10.5px] font-semibold text-amber-800">
      {children}
    </span>
  );
}
