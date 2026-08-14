"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock,
  GitBranch,
  List,
  Pencil,
  Play,
  RefreshCw,
  Shield,
  Wrench,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { Workflow, AgentRun } from "@/types/platform";
import { getWorkflow, getWorkflowGraph, getRuns, triggerWorkflow } from "@/lib/repository";
import { track } from "@/lib/telemetry/client";
import type { WorkflowGraph } from "@/types/workflow-graph";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: string | null) {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const STATUS_RUN: Record<string, { dot: string; text: string }> = {
  succeeded:            { dot: "bg-[#007F4E]",                 text: "text-[#006B45]" },
  failed:               { dot: "bg-red-500",                   text: "text-red-600" },
  running:              { dot: "bg-teal-500 animate-pulse",    text: "text-teal-700" },
  waiting_for_approval: { dot: "bg-amber-500 animate-pulse",   text: "text-amber-700" },
  queued:               { dot: "bg-[#9CA3AF]",                 text: "text-[#6B7280]" },
  cancelled:            { dot: "bg-[#C9CED4]",                 text: "text-[#9CA3AF]" },
  timed_out:            { dot: "bg-orange-500",                text: "text-orange-600" },
};

// ─── Node type colours for the graph steps list ───────────────────────────────

const NODE_TYPE_META: Record<string, { bg: string; text: string; border: string; label: string }> = {
  trigger:   { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE", label: "Trigger" },
  agent:     { bg: "#F5F3FF", text: "#6D28D9", border: "#DDD6FE", label: "Agent" },
  llm:       { bg: "#FAF5FF", text: "#7C3AED", border: "#E9D5FF", label: "LLM" },
  tool:      { bg: "#ECFEFF", text: "#0E7490", border: "#A5F3FC", label: "Tool" },
  approval:  { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", label: "Approval" },
  branch:    { bg: "#F5F3FF", text: "#6D28D9", border: "#DDD6FE", label: "Branch" },
  parallel:  { bg: "#F0F9FF", text: "#0369A1", border: "#BAE6FD", label: "Parallel" },
  join:      { bg: "#EEF2FF", text: "#4338CA", border: "#C7D2FE", label: "Join" },
  timer:     { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A", label: "Timer" },
  end:       { bg: "#ECFDF5", text: "#059669", border: "#A7F3D0", label: "End" },
  http_tool: { bg: "#ECFDF5", text: "#059669", border: "#A7F3D0", label: "HTTP" },
  db_read:   { bg: "#F0F9FF", text: "#0369A1", border: "#BAE6FD", label: "DB Read" },
  db_write:  { bg: "#FEF2F2", text: "#DC2626", border: "#FECACA", label: "DB Write" },
  transform: { bg: "#ECFDF5", text: "#059669", border: "#A7F3D0", label: "Transform" },
  checkpoint:{ bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE", label: "Checkpoint" },
  artifact:  { bg: "#F8FAFC", text: "#475569", border: "#E2E8F0", label: "Artifact" },
};

function NodeTypePill({ type }: { type: string }) {
  const m = NODE_TYPE_META[type] ?? NODE_TYPE_META.end;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E0E3E6] bg-white px-2 py-0.5 font-mono text-[10.5px] font-medium text-[#4B5563]">
      <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: m.text }} />
      {m.label}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [runInputDialog, setRunInputDialog] = useState<Record<string, unknown> | null>(null);
  const [runInputValues, setRunInputValues] = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [wf, runsResult] = await Promise.all([
        getWorkflow(id),
        getRuns({ workflowId: id, pageSize: 8 }),
      ]);
      setWorkflow(wf);
      setRuns(runsResult.items);

      // Also load the graph to show real node steps
      if (wf) {
        try {
          const g = await getWorkflowGraph(wf.id);
          if (g) setGraph(g);
        } catch { /* not critical */ }
      }
      setLoading(false);
    }
    void load();
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-5 w-5 animate-spin text-[#C9CED4]" />
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
        <p className="text-sm font-medium text-[#6B7280]">Workflow not found</p>
        <Link href={"/workflows" as never} className="text-xs text-[#007F4E] hover:underline">
          ← Back to Workflows
        </Link>
      </div>
    );
  }

  const graphNodes = graph?.nodes ?? [];
  const nodeCount = graphNodes.length;

  function getTriggerInputSchema(): Record<string, unknown> | null {
    const triggerNode = graphNodes.find((n) => n.data?.nodeType === "trigger");
    const schema = triggerNode?.data?.triggerConfig?.inputSchema;
    if (!schema || typeof schema !== "object") return null;
    const properties = (schema as Record<string, unknown>).properties;
    if (!properties || typeof properties !== "object" || Object.keys(properties).length === 0) return null;
    return schema as Record<string, unknown>;
  }

  function coerceRunInputValues(schema: Record<string, unknown>, raw: Record<string, string>): Record<string, unknown> {
    const properties = (schema.properties ?? {}) as Record<string, { type?: string }>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === "") continue;
      const type = properties[key]?.type;
      if (type === "number" || type === "integer") {
        const n = Number(value);
        result[key] = Number.isNaN(n) ? value : n;
      } else if (type === "boolean") {
        result[key] = value === "true";
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  const handleRunClick = () => {
    const schema = getTriggerInputSchema();
    if (!schema) {
      void executeRun({});
      return;
    }
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    setRunInputValues(Object.fromEntries(Object.keys(properties).map((k) => [k, ""])));
    setRunInputDialog(schema);
  };

  const confirmRunInputDialog = () => {
    if (!runInputDialog) return;
    const input = coerceRunInputValues(runInputDialog, runInputValues);
    setRunInputDialog(null);
    void executeRun(input);
  };

  const executeRun = async (input: Record<string, unknown>) => {
    track("workflow_run_queued", { workflowId: id, properties: { mode: "simulation", source: "workflow_detail" } });
    setTriggering(true);
    try {
      const run = await triggerWorkflow(id, input);
      toast.success("Workflow started.");
      const orgParam = new URLSearchParams(window.location.search).get("org") ?? "";
      window.location.href = orgParam
        ? `/runs/${run.runId}?org=${encodeURIComponent(orgParam)}`
        : `/runs/${run.runId}`;
    } catch {
      toast.error("Failed to start workflow.");
    } finally {
      setTriggering(false);
    }
  };

  return (
    <div className="page-shell space-y-5">

      {/* ── Breadcrumb ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 text-[12.5px] text-[#9CA3AF]">
        <Link href={"/workflows" as never} className="flex items-center gap-1 font-medium text-[#6B7280] transition-colors hover:text-[#0B0D0F]">
          <ArrowLeft className="h-3 w-3" />
          Workflows
        </Link>
        <span>/</span>
        <span className="font-medium text-[#0B0D0F]">{workflow.name}</span>
      </div>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <h1 className="text-[22px] font-bold tracking-[-0.022em] text-[#0B0D0F]">
              {workflow.name}
            </h1>
            <span
              className="rounded-full border px-2 py-0.5"
              style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                ...(workflow.status === "active"
                  ? { background: "#E6F4EF", color: "#006B45", borderColor: "#9CCFBB" }
                  : workflow.status === "draft"
                  ? { background: "#F3F4F5", color: "#6B7280", borderColor: "#E0E3E6" }
                  : { background: "#FFFBEB", color: "#92400E", borderColor: "#FDE68A" }),
              }}
            >
              {workflow.status}
            </span>
            <span className="rounded-full border border-[#E0E3E6] bg-white px-2 py-0.5 font-mono text-[10px] font-medium capitalize text-[#6B7280]">
              {workflow.creationMode === "native" ? "Native" : workflow.creationMode}
            </span>
          </div>
          {workflow.description && (
            <p className="max-w-2xl text-[13.5px] leading-relaxed text-[#6B7280]">
              {workflow.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 mt-1">
          <Link
            href={`/workflows/${workflow.id}/builder` as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-4 text-[13px] font-semibold text-[#374151] transition-colors hover:bg-[#F7F8F9]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Builder
          </Link>
          <button
            type="button"
            disabled={triggering}
            onClick={handleRunClick}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#007F4E] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#006B45] disabled:opacity-50"
          >
            {triggering
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              : <Play className="h-3.5 w-3.5 fill-white" />
            }
            Run Now
          </button>
        </div>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: "Total Runs",    value: workflow.totalRuns ?? 0,                                     icon: List },
          { label: "Success Rate",  value: `${Math.round((workflow.successRate ?? 0) * 100)}%`,          icon: CheckCircle2 },
          { label: "Agents",        value: (workflow.agentIds ?? []).length,                             icon: Bot },
          { label: "Steps in graph", value: nodeCount > 0 ? nodeCount : (workflow.toolIds ?? []).length, icon: GitBranch },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-[12px] border border-[#E0E3E6] bg-white p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">{label}</p>
              <Icon className="h-4 w-4 text-[#C9CED4]" strokeWidth={1.8} />
            </div>
            <p className="mt-2.5 text-[26px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-[#0B0D0F]">
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* ── Main grid ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">

        {/* ── Left: steps + recent runs ──────────────────────────────────── */}
        <div className="space-y-5">

          {/* Execution Steps (from graph) */}
          <div className="overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white">
            <div className="flex items-center justify-between border-b border-[#ECEEEF] px-[18px]" style={{ height: 50 }}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Graph</span>
                <span className="text-[13.5px] font-bold text-[#0B0D0F]">Execution steps</span>
              </div>
              {nodeCount > 0 && (
                <span className="rounded-full border border-[#E0E3E6] bg-[#F7F8F9] px-2 py-0.5 font-mono text-[10.5px] font-medium text-[#6B7280]">
                  {nodeCount} nodes
                </span>
              )}
            </div>

            {graphNodes.length === 0 ? (
              /* Empty state — graph not yet built */
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-[#9CCFBB] bg-[#E6F4EF]">
                  <GitBranch className="h-5 w-5 text-[#007F4E]" />
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-[#0B0D0F]">No steps built yet</p>
                  <p className="mt-0.5 text-[13px] text-[#9CA3AF]">
                    Open the Builder to design your workflow&apos;s execution graph.
                  </p>
                </div>
                <Link
                  href={`/workflows/${workflow.id}/builder` as never}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-4 text-[13px] font-semibold text-[#374151] transition-colors hover:bg-[#F7F8F9]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Open Builder
                </Link>
              </div>
            ) : (
              <div>
                {graphNodes.map((node, idx) => (
                  <div
                    key={node.id}
                    className="flex items-center gap-3 border-b border-[#F1F2F4] px-[18px] transition-colors last:border-b-0 hover:bg-[#FAFBFB]"
                    style={{ minHeight: 52 }}
                  >
                    {/* Step number + connector */}
                    <div className="relative flex h-full items-center self-stretch">
                      {idx > 0 && <span className="absolute left-1/2 top-0 h-[calc(50%-12px)] w-px -translate-x-1/2 bg-[#E0E3E6]" />}
                      {idx < graphNodes.length - 1 && <span className="absolute bottom-0 left-1/2 h-[calc(50%-12px)] w-px -translate-x-1/2 bg-[#E0E3E6]" />}
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#E0E3E6] bg-white font-mono text-[10.5px] font-semibold text-[#6B7280]">
                        {idx + 1}
                      </span>
                    </div>
                    {/* Label */}
                    <div className="min-w-0 flex-1 py-2">
                      <p className="truncate text-[13.5px] font-semibold text-[#0B0D0F]">
                        {node.data.label}
                      </p>
                      {node.data.description && (
                        <p className="truncate text-[11.5px] text-[#9CA3AF]">
                          {node.data.description}
                        </p>
                      )}
                    </div>
                    {/* Type badge */}
                    <NodeTypePill type={node.type ?? node.data.nodeType} />
                    {/* Checkpoint indicator */}
                    {node.data.agentConfig?.checkpointEnabled && (
                      <span title="Checkpoint enabled" className="inline-block rotate-45 rounded-[2px]" style={{ width: 9, height: 9, background: "#FFFFFF", border: "2px solid #007F4E" }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Runs */}
          <div className="overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white">
            <div className="flex items-center justify-between border-b border-[#ECEEEF] px-[18px]" style={{ height: 50 }}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Activity</span>
                <span className="text-[13.5px] font-bold text-[#0B0D0F]">Recent runs</span>
              </div>
              <Link href={"/runs" as never} className="text-[12px] font-semibold text-[#007F4E] hover:underline">
                View all →
              </Link>
            </div>

            {runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <Play className="h-8 w-8 text-[#E0E3E6]" />
                <p className="text-[13px] text-[#9CA3AF]">No runs yet — hit Run Now to start.</p>
              </div>
            ) : (
              <div>
                {runs.map((run) => {
                  const s = STATUS_RUN[run.status] ?? STATUS_RUN.queued;
                  const displayName = run.workflowName?.trim()
                    ? run.workflowName
                    : `Run ${run.id.slice(0, 8)}`;
                  return (
                    <Link
                      key={run.id}
                      href={`/runs/${run.id}` as never}
                      className="grid items-center border-b border-[#F1F2F4] px-[18px] transition-colors last:border-b-0 hover:bg-[#FAFBFB]"
                      style={{
                        gridTemplateColumns: "8px minmax(0,1fr) 80px 80px",
                        minHeight: 52,
                        gap: 12,
                      }}
                    >
                      <span className={cn("h-2 w-2 rounded-full shrink-0", s.dot)} />
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold leading-[1.25] text-[#0B0D0F]">
                          {displayName}
                        </p>
                        <p className={cn("mt-px text-[11.5px] font-medium capitalize", s.text)}>
                          {run.status.replace(/_/g, " ")}
                        </p>
                      </div>
                      <span className="text-right font-mono text-[12px] tabular-nums text-[#4B5563]">
                        {fmtDuration(run.durationMs)}
                      </span>
                      <span className="text-right text-[12px] text-[#9CA3AF]">
                        {timeAgo(run.startedAt)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: config panels ───────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Schedule & Trigger */}
          <div
            className="rounded-[12px] border border-[#E0E3E6] bg-white"
            style={{ padding: "16px 18px" }}
          >
            <p className="mb-3 flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700, color: "#0B0D0F" }}>
              <CalendarClock className="h-4 w-4 text-[#9CA3AF]" />
              Schedule &amp; Trigger
            </p>
            <div className="space-y-2.5">
              <InfoRow label="Trigger type" value={workflow.triggerType ?? "—"} capitalize />
              {workflow.scheduleConfig?.cronExpression && (
                <InfoRow label="Cron" value={workflow.scheduleConfig.cronExpression} mono />
              )}
              {workflow.scheduleConfig?.timezone && (
                <InfoRow label="Timezone" value={workflow.scheduleConfig.timezone} />
              )}
            </div>
          </div>

          {/* Policies */}
          <div
            className="rounded-[12px] border border-[#E0E3E6] bg-white"
            style={{ padding: "16px 18px" }}
          >
            <p className="mb-3 flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700, color: "#0B0D0F" }}>
              <Shield className="h-4 w-4 text-[#9CA3AF]" />
              Policies
            </p>
            <div className="space-y-2.5">
              {workflow.retryPolicy && (
                <InfoRow label="Retry" value={`${workflow.retryPolicy.maxAttempts}× ${workflow.retryPolicy.backoffType}`} />
              )}
              {workflow.budgetPolicy?.maxTokensPerRun && (
                <InfoRow label="Max tokens/run" value={workflow.budgetPolicy.maxTokensPerRun.toLocaleString()} mono />
              )}
              {workflow.budgetPolicy?.maxCostUsdPerRun && (
                <InfoRow label="Max cost/run" value={`$${workflow.budgetPolicy.maxCostUsdPerRun.toFixed(2)}`} mono />
              )}
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 12.5, color: "#6B7280" }}>Approval required</span>
                <span
                  className="rounded-full border px-2 py-0.5"
                  style={{
                    fontSize: 11.5, fontWeight: 600,
                    ...(workflow.approvalPolicy?.requireApproval
                      ? { background: "#FFFBEB", color: "#92400E", borderColor: "#FDE68A" }
                      : { background: "#F3F4F5", color: "#6B7280", borderColor: "#E0E3E6" }),
                  }}
                >
                  {workflow.approvalPolicy?.requireApproval ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </div>

          {/* Replay */}
          <div
            className="rounded-[12px] border border-[#E0E3E6] bg-white"
            style={{ padding: "16px 18px" }}
          >
            <p className="mb-2 flex items-center gap-2" style={{ fontSize: 13.5, fontWeight: 700, color: "#0B0D0F" }}>
              <RefreshCw className="h-4 w-4 text-[#9CA3AF]" />
              Replay &amp; Checkpoints
            </p>
            <p style={{ fontSize: 12.5, color: "#6B7280", lineHeight: 1.6 }}>
              {workflow.creationMode === "native"
                ? "Full replay available from any checkpoint."
                : workflow.creationMode === "instrumented"
                ? "Partial replay if SDK checkpoints were submitted."
                : "Replay unavailable in endpoint-only mode."}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span
                className="rounded-full border px-2 py-0.5"
                style={{
                  fontSize: 11.5, fontWeight: 600,
                  ...(workflow.creationMode === "native"
                    ? { background: "#E6F4EF", color: "#006B45", borderColor: "#9CCFBB" }
                    : { background: "#FFFBEB", color: "#92400E", borderColor: "#FDE68A" }),
                }}
              >
                {workflow.creationMode === "native" ? "Full replay" : "Limited replay"}
              </span>
              <span style={{ fontSize: 11.5, color: "#9CA3AF" }}>
                {graphNodes.filter((n) => n.data.agentConfig?.checkpointEnabled).length} checkpointed nodes
              </span>
            </div>
          </div>

          {/* Quick links */}
          <div
            className="rounded-[12px] border border-[#E0E3E6] bg-white"
            style={{ padding: "16px 18px" }}
          >
            <p className="mb-3" style={{ fontSize: 13.5, fontWeight: 700, color: "#0B0D0F" }}>Quick links</p>
            <div className="space-y-1">
              {[
                { href: `/workflows/${workflow.id}/builder`, label: "Open Builder", icon: GitBranch },
                { href: "/runs",                             label: "View all runs",  icon: List },
                { href: "/approvals",                        label: "Approval queue", icon: Shield },
              ].map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href as never}
                  className="flex items-center gap-2.5 rounded-[8px] px-2.5 transition-colors hover:bg-[#F3F4F5]"
                  style={{ height: 38, color: "#374151", fontSize: 13.5, fontWeight: 550 }}
                >
                  <Icon className="h-[14px] w-[14px] shrink-0 text-[#9CA3AF]" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Run-with-input dialog — collects values matching the trigger's input schema */}
      {runInputDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0D0F]/40 px-4">
          <div className="w-full max-w-md rounded-[14px] border border-[#E0E3E6] bg-white p-5 shadow-[0_24px_60px_rgba(11,13,15,0.18)]">
            <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Run workflow</p>
            <h2 className="mt-0.5 text-[16px] font-bold tracking-[-0.01em] text-[#0B0D0F]">
              Provide trigger input
            </h2>
            <p className="mt-1 text-[12.5px] text-[#6B7280]">
              This workflow&apos;s trigger expects the following input values.
            </p>
            <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
              {Object.entries((runInputDialog.properties ?? {}) as Record<string, { type?: string; description?: string }>).map(([key, prop]) => {
                const required = ((runInputDialog.required ?? []) as string[]).includes(key);
                return (
                  <div key={key}>
                    <label className="mb-1 block text-[12.5px] font-medium text-[#374151]">
                      {key}{required && <span className="ml-0.5 text-[#DC2626]">*</span>}
                      {prop.type && <span className="ml-1.5 font-mono text-[10px] font-normal text-[#9CA3AF]">({prop.type})</span>}
                    </label>
                    <input
                      value={runInputValues[key] ?? ""}
                      onChange={(e) => setRunInputValues((v) => ({ ...v, [key]: e.target.value }))}
                      placeholder={prop.description ?? ""}
                      className="h-9 w-full rounded-[8px] border border-[#E0E3E6] bg-white px-3 text-[12.5px] text-[#0B0D0F] placeholder:text-[#B6BCC2] focus:border-[#007F4E] focus:outline-none focus:ring-2 focus:ring-[#007F4E]/15"
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRunInputDialog(null)}
                className="inline-flex h-9 items-center rounded-[8px] border border-[#E0E3E6] bg-white px-3.5 text-[12.5px] font-medium text-[#6B7280] transition-colors hover:bg-[#F7F8F9] hover:text-[#0B0D0F]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRunInputDialog}
                className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#007F4E] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#006B45]"
              >
                <Play className="h-3 w-3 fill-white" /> Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small key/value info row ──────────────────────────────────────────────────

function InfoRow({ label, value, mono, capitalize }: { label: string; value: string; mono?: boolean; capitalize?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span style={{ fontSize: 12.5, color: "#6B7280" }}>{label}</span>
      {mono ? (
        <code
          className="rounded-[6px] font-mono"
          style={{ fontSize: 11.5, fontWeight: 600, background: "#F7F8F9", color: "#374151", border: "1px solid #E0E3E6", padding: "2px 8px" }}
        >
          {value}
        </code>
      ) : (
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#374151", textTransform: capitalize ? "capitalize" : undefined }}>
          {value}
        </span>
      )}
    </div>
  );
}
