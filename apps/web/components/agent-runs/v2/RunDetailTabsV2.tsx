"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bot, Clock, FileCode2, GitBranch, History, List, ScrollText, ShieldCheck, Zap,
} from "lucide-react";
import type { AgentRunUiModel } from "@/types/agent-run-ui";
import { RunExecutionTimeline } from "./RunExecutionTimeline";
import { AgentsTab } from "./tabs/AgentsTab";
import { StepsTab } from "./tabs/StepsTab";
import { ApprovalsTab } from "./tabs/ApprovalsTab";
import { OutputTab } from "./tabs/OutputTab";
import { ArtifactsTab } from "./tabs/ArtifactsTab";
import { AuditTab } from "./tabs/AuditTab";
import { RawTab } from "./tabs/RawTab";
import { FlowTab } from "./tabs/FlowTab";

interface RunDetailTabsV2Props {
  model: AgentRunUiModel;
  defaultTab?: string;
}

export function RunDetailTabsV2({ model, defaultTab = "timeline" }: RunDetailTabsV2Props) {
  const { run, agents, timelineEvents, steps, approvals, artifacts, auditLogs } = model;
  const errorCount = timelineEvents.filter(e => e.status === "FAILED").length;
  const stepsDone = steps.filter(s => s.status === "SUCCEEDED").length;
  const pendingApprovals = approvals.filter(a => a.status === "PENDING").length;

  return (
    <Tabs defaultValue={defaultTab} className="space-y-0">
      <div className="sticky top-0 z-10 -mx-0 backdrop-blur-sm" style={{ borderBottom: "1px solid rgba(148,163,184,0.1)", background: "rgba(10,15,26,0.95)" }}>
        <TabsList className="h-auto w-full justify-start rounded-none border-0 bg-transparent p-0 px-1 gap-0">
          <TabTrigger value="timeline" icon={<History className="h-3.5 w-3.5" />} label="Timeline">
            <span className="ml-1 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium tabular-nums">
              {timelineEvents.length}
            </span>
            {errorCount > 0 && (
              <span className="ml-1 rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-medium text-red-600 dark:text-red-400 tabular-nums">
                {errorCount}✗
              </span>
            )}
          </TabTrigger>
          <TabTrigger value="flow" icon={<GitBranch className="h-3.5 w-3.5" />} label="Flow">
            <span className="ml-1 text-[10px] text-muted-foreground">{agents.length}</span>
          </TabTrigger>
          <TabTrigger value="agents" icon={<Bot className="h-3.5 w-3.5" />} label="Agents">
            <span className="ml-1 text-[10px] text-muted-foreground">{agents.length}</span>
          </TabTrigger>
          <TabTrigger value="steps" icon={<List className="h-3.5 w-3.5" />} label="Steps">
            <span className="ml-1 text-[10px] text-muted-foreground">{stepsDone}/{steps.length}</span>
          </TabTrigger>
          {approvals.length > 0 && (
            <TabTrigger value="approvals" icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Approvals">
              {pendingApprovals > 0 && (
                <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  {pendingApprovals} pending
                </span>
              )}
            </TabTrigger>
          )}
          <TabTrigger value="output" icon={<Zap className="h-3.5 w-3.5" />} label="Output" />
          {artifacts.length > 0 && (
            <TabTrigger value="artifacts" icon={<FileCode2 className="h-3.5 w-3.5" />} label="Artifacts">
              <span className="ml-1 text-[10px] text-muted-foreground">{artifacts.length}</span>
            </TabTrigger>
          )}
          <TabTrigger value="audit" icon={<ScrollText className="h-3.5 w-3.5" />} label="Audit" />
          <TabTrigger value="raw" icon={<Clock className="h-3.5 w-3.5" />} label="Raw" />
        </TabsList>
      </div>

      <div className="pt-5">
        <TabsContent value="timeline" className="mt-0">
          <RunExecutionTimeline events={timelineEvents} />
        </TabsContent>

        <TabsContent value="flow" className="mt-0">
          <FlowTab agents={agents} timelineEvents={timelineEvents} />
        </TabsContent>

        <TabsContent value="agents" className="mt-0">
          <AgentsTab agents={agents} />
        </TabsContent>

        <TabsContent value="steps" className="mt-0">
          <StepsTab steps={steps} />
        </TabsContent>

        <TabsContent value="approvals" className="mt-0">
          <ApprovalsTab approvals={approvals} />
        </TabsContent>

        <TabsContent value="output" className="mt-0">
          <OutputTab
            output={model.output}
            partialOutput={model.partialOutput}
            isFailed={run.status === "FAILED"}
          />
        </TabsContent>

        <TabsContent value="artifacts" className="mt-0">
          <ArtifactsTab artifacts={artifacts} />
        </TabsContent>

        <TabsContent value="audit" className="mt-0">
          <AuditTab entries={auditLogs} />
        </TabsContent>

        <TabsContent value="raw" className="mt-0">
          <RawTab model={model} />
        </TabsContent>
      </div>
    </Tabs>
  );
}

// ─── Tab trigger helper ───────────────────────────────────────────────────────

function TabTrigger({
  value,
  icon,
  label,
  children,
}: {
  value: string;
  icon: React.ReactNode;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      className="relative flex items-center gap-1.5 rounded-none border-b-2 border-transparent px-3 py-2.5 text-xs font-medium text-muted-foreground transition-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      {icon}
      {label}
      {children}
    </TabsTrigger>
  );
}
