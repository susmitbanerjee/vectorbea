"use client";

/**
 * /runs/[id] — Run Execution Timeline
 *
 * Loads run data from the Kotlin API and renders with RunDetailsPage —
 * the premium Business View + Engineering View toggle with execution
 * timeline, step details panel, and tabbed details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { RunDetailsPage } from "@/components/runs/RunDetailsPage";
import {
  getRun, getRunTimeline,
  approveRunGate, rejectRunGate,
  retryRunFailedStep, cancelRun,
  streamRunEvents,
} from "@/lib/repository";
import { getActiveWorkspaceId } from "@/lib/api/client";
import type { AgentRun } from "@/types/platform";
import type { RunTimelineEventUi } from "@/types/agent-run-ui";
import type {
  WorkflowRun, RunStep, RunLog, RunEvent,
  ApprovalEvent, ToolCall, RunStatus, StepStatus, StepType,
} from "@/types/runs";

// ─── Mappers ──────────────────────────────────────────────────────────────────

function apiStatusToRunStatus(s: string): RunStatus {
  const m: Record<string, RunStatus> = {
    queued: "queued", running: "running",
    waiting_for_approval: "waiting_for_approval",
    paused: "waiting", succeeded: "completed",
    failed: "failed", cancelled: "cancelled", timed_out: "timed_out",
  };
  return m[s] ?? "queued";
}

function evStatusToStepStatus(s: string): StepStatus {
  const m: Record<string, StepStatus> = {
    PENDING: "queued", RUNNING: "running", SUCCEEDED: "completed",
    FAILED: "failed", WAITING: "waiting", CANCELLED: "cancelled", SKIPPED: "skipped",
  };
  return m[s] ?? "queued";
}

function evTypeToStepType(t: string): StepType {
  if (t.startsWith("AGENT")) return "llm_agent";
  if (t.startsWith("TOOL"))  return "tool_agent";
  if (t.startsWith("HTTP"))  return "http_call";
  if (t.startsWith("LLM"))   return "llm_agent";
  if (t.startsWith("APPROVAL")) return "approval";
  if (t === "RUN_CREATED" || t === "RUN_STARTED") return "trigger";
  if (t === "RUN_SUCCEEDED" || t === "RUN_FAILED") return "system";
  return "system";
}

/**
 * Maps the Kotlin API AgentRun + timeline events into the WorkflowRun shape
 * that RunDetailsPage/ExecutionTimeline/StepDetailsPanel consume.
 */
function mapToWorkflowRun(run: AgentRun, events: RunTimelineEventUi[]): WorkflowRun {
  const startedAt = run.startedAt ?? run.createdAt;
  const endedAt   = run.completedAt ?? undefined;
  const durationMs = run.durationMs
    ?? (endedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : 0);

  // ── Steps: one step per unique stepId (or per isolated event for system steps) ──
  const stepBuckets = new Map<string, RunTimelineEventUi[]>();
  for (const ev of events) {
    const key = ev.stepId ?? `_sys_${ev.id}`;
    if (!stepBuckets.has(key)) stepBuckets.set(key, []);
    stepBuckets.get(key)!.push(ev);
  }

  const steps: RunStep[] = [];
  let offsetMs = 0;
  stepBuckets.forEach((evs, stepId) => {
    const first = evs[0]!;
    const last  = evs[evs.length - 1]!;
    const start = first.startedAt ?? first.timestamp;
    const end   = last.finishedAt ?? last.timestamp;
    const dur   = last.durationMs
      ?? (start && end ? Math.max(0, new Date(end).getTime() - new Date(start).getTime()) : undefined);

    const terminal = [...evs].reverse().find(e =>
      e.status === "SUCCEEDED" || e.status === "FAILED" || e.status === "CANCELLED",
    );
    const status = evStatusToStepStatus(terminal?.status ?? last.status);
    const errorEv = evs.find(e => e.status === "FAILED" || e.errorMessage);

    const businessName = first.agentName ?? first.stepName ?? first.toolName ?? first.title ?? stepId;
    const techName     = first.stepName ?? first.agentName ?? first.toolName ?? first.type ?? stepId;

    steps.push({
      id:                  stepId,
      name:                techName,
      businessName,
      description:         first.summary ?? first.title ?? "",
      businessDescription: first.summary ?? first.title ?? "",
      type:                evTypeToStepType(first.type),
      status,
      startedAt:           start || undefined,
      endedAt:             end || undefined,
      durationMs:          dur,
      offsetMs,
      attemptCount:        evs.filter(e => e.type === "RETRY_STARTED").length + 1,
      model:               first.modelName ?? undefined,
      tokens:              first.tokensUsed ?? undefined,
      costUsd:             first.estimatedCostUsd ?? undefined,
      input:               first.inputJson !== undefined ? first.inputJson : undefined,
      output:              last.outputJson  !== undefined ? last.outputJson  : undefined,
      isReplaySafe:        !errorEv,
      error:               errorEv ? {
        code:      errorEv.type,
        message:   errorEv.errorMessage ?? errorEv.summary ?? "Step failed",
        retryable: true,
      } : undefined,
    });
    offsetMs += dur ?? 0;
  });

  // ── Logs ──────────────────────────────────────────────────────────────────
  const logs: RunLog[] = events.map(ev => ({
    id:        ev.id,
    timestamp: ev.timestamp,
    level:     ev.status === "FAILED" ? "error" : ev.type.includes("RETRY") ? "warn" : "info",
    stepId:    ev.stepId,
    message:   [ev.title, ev.summary].filter(Boolean).join(" — "),
    metadata:  ev.metadataJson as Record<string, unknown> | undefined,
  }));

  // ── Events ────────────────────────────────────────────────────────────────
  const runEvents: RunEvent[] = events.map(ev => ({
    id:            ev.id,
    timestamp:     ev.timestamp,
    type:          ev.type,
    stepId:        ev.stepId,
    correlationId: ev.id,
    payload:       {
      status:     ev.status,
      source:     ev.source,
      agentName:  ev.agentName,
      toolName:   ev.toolName,
      modelName:  ev.modelName,
      summary:    ev.summary,
      durationMs: ev.durationMs,
    },
  }));

  // ── Approvals ─────────────────────────────────────────────────────────────
  const approvals: ApprovalEvent[] = [
    ...run.approvalGates.map(g => ({
      id:          g.id,
      stepId:      (g as unknown as Record<string, string>).nodeId ?? "",
      status:      (g.status === "approved" ? "approved"
                  : g.status === "rejected" ? "rejected"
                  : "requested") as ApprovalEvent["status"],
      requestedAt: (g as unknown as Record<string, string>).requestedAt ?? startedAt,
      decidedAt:   (g as unknown as Record<string, string>).decidedAt ?? undefined,
      requestedBy: "system",
      assignedTo:  (g as unknown as Record<string, string>).assignedTo ?? "reviewer",
      decidedBy:   (g as unknown as Record<string, string>).decidedBy ?? undefined,
    })),
    ...events
      .filter(ev => ev.approval && !run.approvalGates.some(g => g.id === ev.approval!.id))
      .map(ev => ({
        id:          ev.approval!.id,
        stepId:      ev.stepId ?? "",
        status:      (ev.approval!.status === "APPROVED" ? "approved"
                    : ev.approval!.status === "REJECTED" ? "rejected"
                    : "requested") as ApprovalEvent["status"],
        requestedAt: ev.timestamp,
        requestedBy: "system",
        assignedTo:  "reviewer",
      })),
  ];

  // ── Tool calls ────────────────────────────────────────────────────────────
  const toolCalls: ToolCall[] = events
    .filter(ev => ev.toolName && ["TOOL_CALL_STARTED", "TOOL_CALL_COMPLETED", "TOOL_CALL_FAILED"].includes(ev.type))
    .map(ev => ({
      id:             ev.id,
      stepId:         ev.stepId ?? "",
      toolName:       ev.toolName!,
      toolType:       "internal" as ToolCall["toolType"],
      status:         ev.status === "SUCCEEDED" ? "completed"
                    : ev.status === "FAILED"    ? "failed"
                    : "started" as ToolCall["status"],
      startedAt:      ev.startedAt ?? ev.timestamp,
      endedAt:        ev.finishedAt ?? undefined,
      durationMs:     ev.durationMs ?? undefined,
      attempt:        1,
      requestSummary: ev.summary ?? ev.title,
      costUsd:        ev.estimatedCostUsd ?? undefined,
      error:          ev.errorMessage ?? undefined,
    }));

  const retryCount = events.filter(e => e.type === "RETRY_STARTED").length;

  return {
    id:               run.id,
    workflowId:       run.workflowId,
    workflowName:     run.workflowName,
    workflowVersion:  run.workflowVersion,
    status:           apiStatusToRunStatus(run.status),
    triggerType:      run.triggerType === "cron"    ? "schedule"
                    : run.triggerType === "webhook" ? "webhook"
                    : run.triggerType === "api"     ? "api"
                    : "manual",
    environment:      "production",
    startedAt,
    endedAt,
    durationMs,
    totalCostUsd:     run.estimatedCostUsd ?? 0,
    budgetUsd:        0,
    totalTokens:      run.totalTokens ?? 0,
    retryCount,
    recoveredFailureCount: retryCount,
    workerQueue:      "default",
    createdBy:        "user",
    steps,
    logs,
    events:           runEvents,
    approvals,
    toolCalls,
    recoverySummary: {
      recoveredFailures:         retryCount,
      retryAttempts:             retryCount,
      rateLimitEvents:           0,
      workerHeartbeatMisses:     0,
      selfCorrectionAttempts:    0,
      unresolvedBlockers:        run.status === "failed" ? ["Run failed — check error details"] : [],
      replaySafeResumeAvailable: run.replayAvailable,
    },
  };
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function RunDetailPage() {
  const { id }  = useParams<{ id: string }>();
  const router  = useRouter();
  const [workflowRun, setWorkflowRun] = useState<WorkflowRun | null>(null);
  const [loading, setLoading]         = useState(true);
  const sseCloseRef = useRef<(() => void) | null>(null);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!id || id === "undefined") { setLoading(false); return; }
    if (!opts.silent) setLoading(true);
    try {
      const [run, events] = await Promise.all([getRun(id), getRunTimeline(id)]);
      if (!run) throw new Error("not found");
      setWorkflowRun(mapToWorkflowRun(run, events));
    } catch {
      if (!opts.silent) toast.error("Failed to load run details.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // SSE live updates for active runs
  useEffect(() => {
    if (!workflowRun || !id) return;
    const live = ["queued", "running", "waiting_for_approval"].includes(workflowRun.status);
    if (!live) { sseCloseRef.current?.(); return; }

    const wsId  = getActiveWorkspaceId();
    const envId = new URLSearchParams(window.location.search).get("environmentId") ?? "";
    const close = streamRunEvents(id, wsId, envId, {
      onEvent:       () => void load({ silent: true }),
      onComplete:    () => { void load({ silent: true }); sseCloseRef.current = null; },
      onUnavailable: () => { sseCloseRef.current = null; },
    });
    sseCloseRef.current = close;
    return () => { close(); sseCloseRef.current = null; };
  }, [id, workflowRun?.status]);

  // Polling fallback
  useEffect(() => {
    const live = workflowRun && ["queued", "running", "waiting_for_approval"].includes(workflowRun.status);
    if (!live) return;
    const t = setInterval(() => void load({ silent: true }), 4000);
    return () => clearInterval(t);
  }, [workflowRun?.status, load]);

  // Action handler passed into RunDetailsPage
  async function handleAction(action: string, payload?: Record<string, string>) {
    if (!id) return;
    try {
      switch (action) {
        case "approve":
          if (payload?.approvalId) { await approveRunGate(id, payload.approvalId); toast.success("Approved."); void load(); }
          break;
        case "reject":
          if (payload?.approvalId) { await rejectRunGate(id, payload.approvalId); toast.success("Rejected."); void load(); }
          break;
        case "retry":
        case "retry_step":
          await retryRunFailedStep(id, ""); toast.success("Retry queued."); void load();
          break;
        case "cancel":
          await cancelRun(id); toast.success("Cancelled."); void load({ silent: true });
          break;
        case "open_workflow":
          if (workflowRun) router.push(`/workflows/${workflowRun.workflowId}/builder` as never);
          break;
        default:
          toast.info(`${action} will be connected shortly.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed.");
    }
  }

  // ── Loading / not found ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workflowRun) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <p className="text-sm font-medium text-muted-foreground">Run not found</p>
        <Link href={"/runs" as never} className="flex items-center gap-1 text-[12px] text-primary hover:underline">
          <ArrowLeft className="h-3 w-3" /> Back to Runs
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-full" style={{ background: "#F8FAFC" }}>
      {/* Top nav bar */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 px-6 py-3"
        style={{ background: "#FFFFFF" }}
      >
        <Link
          href={"/runs" as never}
          className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All Runs
        </Link>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Run Details — Business View / Engineering View */}
      <RunDetailsPage run={workflowRun} onAction={handleAction} />
    </div>
  );
}
