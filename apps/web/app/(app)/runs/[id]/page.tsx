"use client";

/**
 * /runs/[id] — canonical run detail page.
 *
 * Live updates strategy:
 *   1. Primary: SSE stream via GET /api/runs/:id/stream.
 *      Events arrive in real-time without polling.
 *   2. Fallback: polling every 4 s if SSE is unavailable (no Redis, old browser, etc.)
 *
 * Local (native) runs get full approval, retry, and replay support.
 * API-backed runs use remote endpoints.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { RunHeaderV2 } from "@/components/agent-runs/v2/RunHeader";
import { RunSummaryCards } from "@/components/agent-runs/v2/RunSummaryCards";
import { RunDetailTabsV2 } from "@/components/agent-runs/v2/RunDetailTabsV2";
import {
  getRun,
  getRunTimeline,
  approveRunGate,
  rejectRunGate,
  retryRunFailedStep,
  replayWorkflowRun,
  cancelRun,
  listRunCheckpoints,
  streamRunEvents,
} from "@/lib/repository";
import { getActiveWorkspaceId } from "@/lib/api/client";
import type { AgentRunUiModel, RunTimelineEventUi } from "@/types/agent-run-ui";
import type { RunCheckpoint } from "@/types/platform";

function buildPlatformRunModel(
  run: import("@/types/platform").AgentRun,
  events: RunTimelineEventUi[],
): AgentRunUiModel {
  const statusMap: Record<string, AgentRunUiModel["run"]["status"]> = {
    queued: "QUEUED", running: "RUNNING", waiting_for_approval: "WAITING_FOR_APPROVAL",
    paused: "RUNNING", succeeded: "SUCCEEDED", failed: "FAILED",
    cancelled: "CANCELLED", timed_out: "TIMEOUT",
  };

  // Derive agent summaries from timeline events
  const agentNames = [...new Set(events.filter((e) => e.agentName).map((e) => e.agentName!))];
  const agents = agentNames.map((name) => {
    const ae = events.filter((e) => e.agentName === name);
    const started = ae.find((e) => e.type === "AGENT_STARTED");
    const ended = ae.find((e) => e.type === "AGENT_COMPLETED" || e.type === "AGENT_FAILED");
    return {
      id: `agent-${name.toLowerCase().replace(/\s+/g, "-")}`,
      name, role: name,
      status: (ended?.type === "AGENT_FAILED" ? "FAILED" : ended ? "SUCCEEDED" : "RUNNING") as "RUNNING" | "SUCCEEDED" | "FAILED",
      startedAt: started?.timestamp,
      finishedAt: ended?.timestamp,
      durationMs: ended?.durationMs,
      stepsCount: ae.length,
      tokensUsed: ae.reduce((s, e) => s + (e.tokensUsed ?? 0), 0) || undefined,
      estimatedCostUsd: ae.reduce((s, e) => s + (e.estimatedCostUsd ?? 0), 0) || undefined,
      toolsUsed: [...new Set(ae.filter((e) => e.toolName).map((e) => e.toolName!))],
    };
  });

  return {
    run: {
      id: run.id,
      jobId: run.workflowId,
      jobName: run.workflowName,
      title: run.workflowName,
      status: statusMap[run.status] ?? "QUEUED",
      triggerSource: run.triggerType === "cron" ? "SCHEDULE" : "MANUAL",
      attemptNumber: 1,
      environment: "Production",
      idempotencyKey: run.idempotencyKey ?? `idem-${run.id}`,
      startedAt: run.startedAt ?? run.createdAt,
      finishedAt: run.completedAt ?? undefined,
      durationMs: run.durationMs ?? undefined,
      totalTokens: run.totalTokens ?? undefined,
      estimatedCostUsd: run.estimatedCostUsd ?? undefined,
      errorMessage: run.error ?? undefined,
    },
    agents,
    timelineEvents: events,
    steps: [],
    approvals: [],
    artifacts: [],
    auditLogs: [],
    input: run.input,
    output: run.output,
    runMetadata: {
      searchAttributes: {
        workflowId: run.workflowId,
        workflowVersion: run.workflowVersion,
        creationMode: run.creationMode,
      },
      aiMetadata: { primaryModel: agents[0]?.name ?? "gpt-4.1-mini" },
      budgetMetadata: {},
      retryPolicy: { maxAttempts: 2 },
      executionMetadata: { workerId: "worker-001" },
    },
  };
}

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [model, setModel] = useState<AgentRunUiModel | null>(null);
  const [isLocalRun, setIsLocalRun] = useState(false);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [forcePausedPending, setForcePausedPending] = useState(false);
  const [retryWarnings, setRetryWarnings] = useState<string[]>([]);
  const [checkpoints, setCheckpoints] = useState<RunCheckpoint[]>([]);
  /** true while SSE connection is active — disables fallback polling */
  const [sseActive, setSseActive] = useState(false);
  const sseCloseRef = useRef<(() => void) | null>(null);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!id || id === "undefined") {
      toast.error("Invalid run ID.");
      setLoading(false);
      return;
    }
    if (!opts.silent) setLoading(true);
    try {
      const [platformRun, timelineEvents] = await Promise.all([getRun(id), getRunTimeline(id)]);

      if (platformRun) {
        setModel(buildPlatformRunModel(platformRun, timelineEvents));
        setIsLocalRun(true);
        const ckpts = await listRunCheckpoints(id);
        setCheckpoints(ckpts as RunCheckpoint[]);
        return;
      }

      // Run not found in Kotlin API
      throw new Error("Run not found");
    } catch {
      if (!opts.silent) toast.error("Failed to load run details.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // ── SSE live stream ────────────────────────────────────────────────────────
  // Open an SSE connection once we know the run is live (RUNNING or QUEUED).
  // On run_event: silently reload the run to get updated state.
  // On run_complete: do a final load and stop SSE.
  // On stream_unavailable or error: fall back to polling.
  useEffect(() => {
    if (!id || id === "undefined") return;
    if (!model) return;

    const live = ["RUNNING", "QUEUED", "WAITING_FOR_APPROVAL"].includes(model.run.status);
    if (!live) {
      // Run is already terminal — close any open SSE connection
      sseCloseRef.current?.();
      sseCloseRef.current = null;
      setSseActive(false);
      return;
    }

    // Don't open a second connection if one is already active
    if (sseActive && sseCloseRef.current) return;

    const workspaceId = getActiveWorkspaceId();
    const environmentId =
      new URLSearchParams(window.location.search).get("environmentId") ?? "";

    const close = streamRunEvents(id, workspaceId, environmentId, {
      onEvent: () => {
        // A new event arrived — silently reload to pick up status changes
        void load({ silent: true });
      },
      onComplete: () => {
        // Run reached terminal state
        void load({ silent: true });
        setSseActive(false);
        sseCloseRef.current = null;
      },
      onHeartbeat: () => {
        // keep-alive — no action needed
      },
      onUnavailable: () => {
        // Redis unavailable — fall back to polling
        setSseActive(false);
        sseCloseRef.current = null;
      },
      onError: () => {
        // EventSource auto-reconnects on transient errors
        // Only mark SSE as inactive if it actually closes
      },
    });

    sseCloseRef.current = close;
    setSseActive(true);

    return () => {
      close();
      sseCloseRef.current = null;
      setSseActive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, model?.run.status]);

  // ── Fallback polling (only when SSE is not active) ─────────────────────────
  useEffect(() => {
    if (!model) return;
    const live = ["RUNNING", "QUEUED", "WAITING_FOR_APPROVAL"].includes(model.run.status);
    if (!live) return;
    // Don't poll if SSE is active — SSE already covers live updates
    if (sseActive) return;
    const interval = setInterval(() => void load({ silent: true }), 4000);
    return () => clearInterval(interval);
  }, [model, load, sseActive]);


  // ── Local approval handlers ────────────────────────────────────────────────

  async function handleApprove(approvalId: string) {
    setActing(true);
    try {
      await approveRunGate(id, approvalId);
      toast.success("Approved — run resumed.");
      await load();
    } catch {
      toast.error("Failed to approve.");
    } finally {
      setActing(false);
    }
  }

  async function handleReject(approvalId: string) {
    setActing(true);
    try {
      await rejectRunGate(id, approvalId);
      toast.success("Rejected — run failed.");
      await load();
    } catch {
      toast.error("Failed to reject.");
    } finally {
      setActing(false);
    }
  }

  // ── Retry handler ─────────────────────────────────────────────────────────

  async function handleRetry(_forcePaused = false) {
    setActing(true);
    setRetryWarnings([]);
    setForcePausedPending(false);
    try {
      await retryRunFailedStep(id, "");
      toast.success("Retry queued.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to retry.");
    } finally {
      setActing(false);
    }
  }

  // ── Cancel handler ────────────────────────────────────────────────────────

  async function handleCancel() {
    setActing(true);
    try {
      await cancelRun(id);
      toast.success("Run cancelled.");
      void load({ silent: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel.");
    } finally {
      setActing(false);
    }
  }

  // ── Replay handler ────────────────────────────────────────────────────────

  async function handleReplay(checkpointId?: string) {
    setActing(true);
    try {
      const newRun = await replayWorkflowRun(id, checkpointId);
      if (!newRun) throw new Error("Replay unavailable");
      toast.success("Replay started.");
      router.push(`/runs/${newRun.id}` as never);
    } catch {
      toast.error("Failed to start replay.");
    } finally {
      setActing(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading && !model) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm font-medium text-muted-foreground">Run not found</p>
        <Link href={"/runs" as never} className="flex items-center gap-1 text-[12px] text-primary hover:underline">
          <ArrowLeft className="h-3 w-3" />
          Back to Runs
        </Link>
      </div>
    );
  }

  const displayModel: AgentRunUiModel = forcePausedPending
    ? { ...model, run: { ...model.run, errorMessage: (model.run.errorMessage ? model.run.errorMessage + " · " : "") + "Workflow paused — confirm retry to proceed" } }
    : model;

  const pendingApprovals = model.approvals.filter((a) => a.status === "PENDING");
  const canReplay = isLocalRun && model.run.status !== "RUNNING" && model.run.status !== "QUEUED" && checkpoints.length > 0;
  const isFailed = model.run.status === "FAILED";
  const isWaitingApproval = model.run.status === "WAITING_FOR_APPROVAL";

  return (
    <div className="min-h-full p-6 pb-16 lg:p-8">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Breadcrumb */}
        <Link href={"/runs" as never} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" />
          Runs
        </Link>

        {retryWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 space-y-1">
            {retryWarnings.map((w, i) => <p key={i}><span className="font-semibold">Warning:</span> {w}</p>)}
          </div>
        )}

        {forcePausedPending && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">The workflow is paused. Retry anyway?</p>
            <div className="flex gap-2 shrink-0">
              <button type="button" onClick={() => setForcePausedPending(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium hover:bg-muted">Cancel</button>
              <button type="button" disabled={acting} onClick={() => void handleRetry(true)}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {acting ? "Retrying…" : "Retry anyway"}
              </button>
            </div>
          </div>
        )}

        {/* Approval Banner */}
        {isWaitingApproval && pendingApprovals.length > 0 && isLocalRun && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-amber-800">Approval Required</p>
                <p className="mt-0.5 text-xs text-amber-700">
                  This run is paused waiting for human approval before continuing.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => void handleApprove(pendingApprovals[0]!.id)}
                  className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {acting ? "…" : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={acting}
                  onClick={() => void handleReject(pendingApprovals[0]!.id)}
                  className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {acting ? "…" : "Reject"}
                </button>
              </div>
            </div>
            <p className="text-xs text-amber-700">
              Step: <span className="font-mono">{pendingApprovals[0]!.relatedStep}</span>
            </p>
          </div>
        )}

        {/* Failed — local retry banner */}
        {isFailed && isLocalRun && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-red-700">Run Failed</p>
              {model.run.errorMessage && (
                <p className="mt-0.5 text-xs text-red-600">{model.run.errorMessage}</p>
              )}
            </div>
            <button
              type="button"
              disabled={acting}
              onClick={() => void handleRetry()}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {acting ? "Retrying…" : "Retry from failed step"}
            </button>
          </div>
        )}

        {/* Replay section */}
        {canReplay && (
          <div className="rounded-xl border border-border bg-muted/10 px-5 py-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">Replay Available</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {checkpoints.length} checkpoint{checkpoints.length !== 1 ? "s" : ""} — replay from start or a specific checkpoint.
                </p>
              </div>
              <button
                type="button"
                disabled={acting}
                onClick={() => void handleReplay()}
                className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {acting ? "Starting…" : "Replay from start"}
              </button>
            </div>
            {checkpoints.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-border/30 pt-3">
                {checkpoints.map((ckpt) => (
                  <button
                    key={ckpt.id}
                    type="button"
                    disabled={acting}
                    onClick={() => void handleReplay(ckpt.id)}
                    className="rounded-lg border border-border px-3 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    After step <span className="font-mono">{ckpt.stepId}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Replay unavailable notice for non-native runs */}
        {!isLocalRun && model.run.status === "FAILED" && (
          <div className="rounded-xl border border-border bg-muted/10 px-5 py-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Replay unavailable</span> — replay is only supported for native workflow runs.
            </p>
          </div>
        )}

        <RunHeaderV2
          model={displayModel}
          onRetry={!forcePausedPending ? () => void handleRetry(false) : undefined}
          onCancel={handleCancel}
        />
        <RunSummaryCards model={model} />
        <RunDetailTabsV2
          model={model}
          onApprove={isLocalRun ? handleApprove : undefined}
          onReject={isLocalRun ? handleReject : undefined}
        />
      </div>
    </div>
  );
}
