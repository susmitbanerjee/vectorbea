"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock,
  GitBranch,
  List,
  Play,
  RefreshCw,
  Shield,
  Wrench,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Workflow, AgentRun } from "@/types/platform";
import { getWorkflow, getRuns, triggerWorkflow } from "@/lib/repository";

function StepTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    agent: "bg-violet-50 text-violet-700 border-violet-200",
    llm: "bg-purple-50 text-purple-700 border-purple-200",
    tool: "bg-blue-50 text-blue-700 border-blue-200",
    approval: "bg-amber-50 text-amber-700 border-amber-200",
    branch: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
    end: "bg-[#F9FAFB] text-[#6B7280] border-[#E5E7EB]",
  };
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize", colors[type] ?? colors.end)}>
      {type}
    </span>
  );
}

function RunStatusDot({ status }: { status: AgentRun["status"] }) {
  const colors: Record<string, string> = {
    succeeded: "bg-emerald-500",
    failed: "bg-red-500",
    running: "bg-blue-500 animate-pulse",
    waiting_for_approval: "bg-amber-500",
    queued: "bg-[#9CA3AF]",
    cancelled: "bg-[#D1D5DB]",
    timed_out: "bg-orange-500",
    paused: "bg-amber-400",
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", colors[status] ?? "bg-slate-400")} />
      <span className="text-[12px] capitalize text-muted-foreground">{status.replace(/_/g, " ")}</span>
    </span>
  );
}

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [wf, runsResult] = await Promise.all([
        getWorkflow(id),
        getRuns({ workflowId: id, pageSize: 10 }),
      ]);
      setWorkflow(wf);
      setRuns(runsResult.items);
      setLoading(false);
    }
    void load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
        <p className="text-sm font-medium text-muted-foreground">Workflow not found</p>
        <Link href={"/workflows" as never} className="text-xs text-primary hover:underline">
          ← Back to Workflows
        </Link>
      </div>
    );
  }

  return (
    <div className="page-shell">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Link href={"/workflows" as never} className="flex items-center gap-1 hover:text-foreground transition-colors">
          <ArrowLeft className="h-3 w-3" />
          Workflows
        </Link>
        <span>/</span>
        <span className="text-foreground">{workflow.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[20px] font-semibold tracking-tight">{workflow.name}</h1>
            <span className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              workflow.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
              workflow.status === "draft" ? "bg-[#F9FAFB] text-[#6B7280] border-[#E5E7EB]" :
              "bg-amber-50 text-amber-700 border-amber-200"
            )}>
              {workflow.status}
            </span>
            <span className="rounded border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[10px] font-medium text-[#1D4ED8]">
              {workflow.creationMode === "native" ? "Native" : workflow.creationMode}
            </span>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">{workflow.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/workflows/${workflow.id}/builder` as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <GitBranch className="h-3.5 w-3.5" />
            Builder
          </Link>
          <button
            type="button"
            disabled={triggering}
            onClick={async () => {
              setTriggering(true);
              try {
                const run = await triggerWorkflow(id, {});
                toast.success("Workflow started.");
                const orgParam = new URLSearchParams(window.location.search).get("org") ?? new URLSearchParams(window.location.search).get("workspaceId") ?? "";
                const executeUrl = `/api/platform/workflows/${id}/run/${run.runId}/execute${orgParam ? `?workspaceId=${encodeURIComponent(orgParam)}` : ""}`;
                void fetch(executeUrl, { method: "POST" });
                window.location.href = orgParam ? `/runs/${run.runId}?org=${encodeURIComponent(orgParam)}` : `/runs/${run.runId}`;
              } catch {
                toast.error("Failed to start workflow.");
              } finally {
                setTriggering(false);
              }
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {triggering ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run Now
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Runs",    value: workflow.totalRuns,                  icon: List },
          { label: "Success Rate",  value: `${Math.round(workflow.successRate * 100)}%`, icon: CheckCircle2 },
          { label: "Agents",        value: workflow.agentIds.length,            icon: Bot },
          { label: "Tools",         value: workflow.toolIds.length,             icon: Wrench },
        ].map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-border/60 p-4"
            style={{ background: "var(--surface-1)" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</span>
            </div>
            <p className="text-[20px] font-semibold tracking-tight">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Steps */}
        <div className="rounded-xl border border-border/60 overflow-hidden" style={{ background: "var(--surface-1)" }}>
          <div className="border-b border-border/60 px-5 py-3">
            <h2 className="text-[13px] font-semibold">Execution Steps</h2>
          </div>
          <div className="divide-y divide-border/40">
            {workflow.steps.map((step, idx) => (
              <div key={step.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">{step.name}</p>
                  {step.agentId && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      Agent: {step.agentId.replace("agent-", "")}
                    </p>
                  )}
                </div>
                <StepTypeBadge type={step.type} />
                {step.checkpointEnabled && (
                  <span title="Checkpoint enabled" className="text-[#9CA3AF]">
                    <Shield className="h-3 w-3" />
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Config panel */}
        <div className="space-y-4">
          {/* Schedule */}
          <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
            <h2 className="mb-3 text-[13px] font-semibold flex items-center gap-2">
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground/60" />
              Schedule &amp; Trigger
            </h2>
            <div className="space-y-2 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Trigger type</span>
                <span className="capitalize font-medium">{workflow.triggerType}</span>
              </div>
              {workflow.scheduleConfig && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Cron</span>
                    <code className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">{workflow.scheduleConfig.cronExpression}</code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Timezone</span>
                    <span className="font-medium">{workflow.scheduleConfig.timezone}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Policies */}
          <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
            <h2 className="mb-3 text-[13px] font-semibold flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-muted-foreground/60" />
              Policies
            </h2>
            <div className="space-y-2 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Retry</span>
                <span className="font-medium">{workflow.retryPolicy.maxAttempts}× {workflow.retryPolicy.backoffType}</span>
              </div>
              {workflow.budgetPolicy.maxTokensPerRun && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Max tokens/run</span>
                  <span className="font-mono font-medium">{workflow.budgetPolicy.maxTokensPerRun.toLocaleString()}</span>
                </div>
              )}
              {workflow.budgetPolicy.maxCostUsdPerRun && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Max cost/run</span>
                  <span className="font-mono font-medium">${workflow.budgetPolicy.maxCostUsdPerRun.toFixed(2)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Approval required</span>
                <span className={cn("font-medium", workflow.approvalPolicy.requireApproval ? "text-amber-700" : "text-muted-foreground")}>
                  {workflow.approvalPolicy.requireApproval ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </div>

          {/* Replay */}
          <div className="rounded-xl border border-border/60 px-5 py-4" style={{ background: "var(--surface-1)" }}>
            <h2 className="mb-1 text-[13px] font-semibold flex items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground/60" />
              Replay &amp; Checkpoints
            </h2>
            <p className="text-[12px] text-muted-foreground">
              {workflow.creationMode === "native"
                ? "Full replay available from any checkpoint. Steps with checkpoint enabled can be resumed independently."
                : workflow.creationMode === "instrumented"
                ? "Partial replay available if checkpoints were submitted via the SDK."
                : "Replay unavailable in endpoint-only mode."}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <span className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                workflow.creationMode === "native"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-700 border-amber-200",
              )}>
                {workflow.creationMode === "native" ? "Full replay" : "Limited replay"}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {workflow.steps.filter((s) => s.checkpointEnabled).length} checkpointed steps
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Runs */}
      {runs.length > 0 && (
        <div className="rounded-xl border border-border/60 overflow-hidden" style={{ background: "var(--surface-1)" }}>
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
            <h2 className="text-[13px] font-semibold">Recent Runs</h2>
            <Link href={"/runs" as never} className="text-[11px] text-primary hover:underline">View all →</Link>
          </div>
          <div className="divide-y divide-border/40">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}` as never}
                className="flex items-center gap-4 px-5 py-3 hover:bg-muted/20 transition-colors"
              >
                <RunStatusDot status={run.status} />
                <span className="font-mono text-[11px] text-muted-foreground/60">{run.id.slice(0, 14)}…</span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground ml-auto">
                  <Clock className="h-3 w-3" />
                  {run.durationMs ? `${(run.durationMs / 1000).toFixed(0)}s` : "—"}
                </span>
                {run.estimatedCostUsd !== null && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    ${run.estimatedCostUsd.toFixed(4)}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
