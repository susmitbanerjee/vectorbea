"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeftRight, Bot, Braces, FileCode2, GitBranch, History, List,
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
      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-10 backdrop-blur-sm"
        style={{ borderBottom: "1px solid rgba(148,163,184,0.09)", background: "rgba(9,14,24,0.96)" }}
      >
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-0 bg-transparent p-0 px-0 gap-0 flex-nowrap">

          <TabTrigger value="timeline" icon={<History className="h-3.5 w-3.5" />} label="Timeline">
            <Badge>{timelineEvents.length}</Badge>
            {errorCount > 0 && <ErrorBadge>{errorCount}✗</ErrorBadge>}
          </TabTrigger>

          <TabTrigger value="flow" icon={<GitBranch className="h-3.5 w-3.5" />} label="Flow">
            <Badge>{agents.length}</Badge>
          </TabTrigger>

          <TabTrigger value="events" icon={<TableProperties className="h-3.5 w-3.5" />} label="Events">
            <Badge>{timelineEvents.length}</Badge>
          </TabTrigger>

          <TabTrigger value="agents" icon={<Bot className="h-3.5 w-3.5" />} label="Agents">
            <Badge>{agents.length}</Badge>
          </TabTrigger>

          <TabTrigger value="approvals" icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Approvals">
            {pendingApprovals > 0
              ? <WarnBadge>{pendingApprovals} pending</WarnBadge>
              : approvals.length > 0 ? <Badge>{approvals.length}</Badge> : null
            }
          </TabTrigger>

          <TabTrigger value="io" icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Input/Output" />

          <TabTrigger value="artifacts" icon={<FileCode2 className="h-3.5 w-3.5" />} label="Artifacts">
            {artifacts.length > 0 && <Badge>{artifacts.length}</Badge>}
          </TabTrigger>

          <TabTrigger value="metadata" icon={<Braces className="h-3.5 w-3.5" />} label="Metadata" />

          <TabTrigger value="raw" icon={<ScrollText className="h-3.5 w-3.5" />} label="Raw" />
        </TabsList>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <div className="pt-5">
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

// ─── Tab trigger helpers ──────────────────────────────────────────────────────

function TabTrigger({
  value, icon, label, children,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      className="relative flex shrink-0 items-center gap-1.5 rounded-none border-b-2 border-transparent px-3 py-2.5 text-[12px] font-medium text-muted-foreground whitespace-nowrap transition-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {icon}
      {label}
      {children}
    </TabsTrigger>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="ml-1 rounded-full px-1.5 py-px text-[10px] font-medium tabular-nums"
      style={{ background: "rgba(148,163,184,0.12)", color: "var(--text-faint)" }}
    >
      {children}
    </span>
  );
}

function ErrorBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1 rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-medium tabular-nums text-red-400">
      {children}
    </span>
  );
}

function WarnBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-400">
      {children}
    </span>
  );
}
