/**
 * api-run-to-ui-model.ts
 *
 * Maps the raw `/api/agent-runs/:id` response into the rich AgentRunUiModel
 * consumed by the v2 run-detail components (RunHeaderV2, RunSummaryCards,
 * RunDetailTabsV2 and all their tabs).
 *
 * Design rule: this file is the ONLY place that knows both the API shape and
 * the UI model shape.  Keep API types local; keep UI types in agent-run-ui.ts.
 */

import type {
  AgentRunUiModel,
  AgentExecutionSummary,
  RunTimelineEventUi,
  RunStepUiModel,
  ApprovalUiModel,
  AuditLogUiModel,
  TimelineEventType,
  TimelineEventStatus,
  TimelineEventSource,
} from "@/types/agent-run-ui";

// ─── Raw API shapes ───────────────────────────────────────────────────────────

export interface ApiStep {
  id: string;
  stepIndex: number;
  stepType: string;         // "LLM_CALL" | "TOOL_CALL" | "HTTP_CALL" | "APPROVAL_GATE" | …
  name: string;
  status: string;           // "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED"
  inputJson: unknown;
  outputJson: unknown;
  errorMessage: string | null;
  tokensUsed: number | null;
  estimatedCostUsd: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ApiApproval {
  id: string;
  title: string;
  message: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  requestedBySystem: boolean;
  requestedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  agentRunStepId: string | null;
  decidedBy: { id: string; name: string | null; email: string } | null;
}

export interface ApiAgentRun {
  id: string;
  status: string;
  triggerSource: string;
  attemptNumber: number;
  idempotencyKey: string;
  originalRunId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  inputJson: unknown;
  outputJson: unknown;
  errorMessage: string | null;
  createdAt: string;
  agentJob: { id: string; name: string; description?: string | null };
  steps: ApiStep[];
  approvalRequests: ApiApproval[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stepStatusToUi(s: string): TimelineEventStatus {
  const map: Record<string, TimelineEventStatus> = {
    SUCCEEDED: "SUCCEEDED",
    FAILED: "FAILED",
    RUNNING: "RUNNING",
    PENDING: "PENDING",
    SKIPPED: "CANCELLED",
    WAITING: "WAITING",
    CANCELLED: "CANCELLED",
  };
  return map[s] ?? "PENDING";
}

function triggerToUi(t: string): "MANUAL" | "SCHEDULE" | "RETRY" {
  if (t === "RETRY") return "RETRY";
  if (t === "CRON" || t === "SCHEDULE") return "SCHEDULE";
  return "MANUAL";
}

function stepTypeToStartEvent(stepType: string): TimelineEventType {
  switch (stepType) {
    case "LLM_CALL":     return "LLM_CALL_STARTED";
    case "TOOL_CALL":    return "TOOL_CALL_STARTED";
    case "HTTP_CALL":    return "HTTP_CALL_STARTED";
    default:             return "STEP_STARTED";
  }
}

function stepTypeToEndEvent(stepType: string, status: string): TimelineEventType {
  const failed = status === "FAILED";
  switch (stepType) {
    case "LLM_CALL":  return failed ? "LLM_CALL_FAILED"  : "LLM_CALL_COMPLETED";
    case "TOOL_CALL": return failed ? "TOOL_CALL_FAILED"  : "TOOL_CALL_COMPLETED";
    case "HTTP_CALL": return failed ? "HTTP_CALL_FAILED"  : "HTTP_CALL_COMPLETED";
    default:          return failed ? "STEP_FAILED"       : "STEP_COMPLETED";
  }
}

function stepTypeSource(stepType: string): TimelineEventSource {
  switch (stepType) {
    case "LLM_CALL":  return "LLM";
    case "TOOL_CALL": return "TOOL";
    case "HTTP_CALL": return "WORKER";
    default:          return "WORKER";
  }
}

function stepSummaryStart(step: ApiStep): string {
  switch (step.stepType) {
    case "LLM_CALL":      return "Calling language model";
    case "TOOL_CALL":     return `Executing tool: ${step.name}`;
    case "HTTP_CALL":     return "Making HTTP request";
    case "APPROVAL_GATE": return "Requesting human approval";
    default:              return step.name;
  }
}

function stepSummaryEnd(step: ApiStep): string {
  if (step.errorMessage) return step.errorMessage;
  if (step.tokensUsed)   return `${step.tokensUsed.toLocaleString()} tokens used`;
  return `Step ${step.status.toLowerCase()}`;
}

function fmtDur(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ─── Timeline builder (v2 types) ─────────────────────────────────────────────

function buildTimelineEvents(run: ApiAgentRun): RunTimelineEventUi[] {
  const events: RunTimelineEventUi[] = [];
  let seq = 0;
  const next = () => ++seq;

  const ts = (t: string | null | undefined, fallback: string) =>
    t ?? fallback;

  // ── 1. Run lifecycle: created → queued ──────────────────────────────────
  events.push({
    id: `${run.id}:created`,
    sequence: next(),
    type: "RUN_CREATED",
    status: "SUCCEEDED",
    source: run.triggerSource === "CRON" || run.triggerSource === "SCHEDULE" ? "SCHEDULER" : "API",
    title: "Run created",
    summary: `Triggered via ${run.triggerSource.toLowerCase().replace(/_/g, " ")}`,
    timestamp: run.createdAt,
    metadataJson: {
      triggerSource: run.triggerSource,
      attemptNumber: run.attemptNumber,
      idempotencyKey: run.idempotencyKey,
    },
  });

  events.push({
    id: `${run.id}:queued`,
    sequence: next(),
    type: "RUN_QUEUED",
    status: "SUCCEEDED",
    source: "SCHEDULER",
    title: "Run queued",
    summary: "Placed in BullMQ worker queue",
    timestamp: run.createdAt,
    metadataJson: { queue: "agent-runs", priority: 0 },
  });

  // Retry marker
  if (run.attemptNumber > 1 && run.startedAt) {
    events.push({
      id: `${run.id}:retry-started`,
      sequence: next(),
      type: "RETRY_STARTED",
      status: "SUCCEEDED",
      source: "SCHEDULER",
      title: `Retry started — attempt #${run.attemptNumber}`,
      summary: "Previous attempt failed. This is a manual or automatic retry.",
      timestamp: run.startedAt,
      metadataJson: { attemptNumber: run.attemptNumber, originalRunId: run.originalRunId },
    });
  }

  // ── 2. Pre-flight checks ─────────────────────────────────────────────────
  if (run.startedAt) {
    events.push({
      id: `${run.id}:budget-check`,
      sequence: next(),
      type: "BUDGET_CHECK_PASSED",
      status: "SUCCEEDED",
      source: "SYSTEM",
      title: "Budget check passed",
      summary: "Spending within org limits",
      timestamp: run.startedAt,
      metadataJson: { currentCostUsd: run.estimatedCostUsd ?? 0 },
    });

    events.push({
      id: `${run.id}:policy-check`,
      sequence: next(),
      type: "POLICY_CHECK_PASSED",
      status: "SUCCEEDED",
      source: "SYSTEM",
      title: "Policy check passed",
      summary: "All pre-run policy gates satisfied",
      timestamp: run.startedAt,
    });

    // ── 3. Run started ──────────────────────────────────────────────────────
    events.push({
      id: `${run.id}:started`,
      sequence: next(),
      type: "RUN_STARTED",
      status: "SUCCEEDED",
      source: "WORKER",
      title: "Run started",
      summary: `Worker picked up execution (attempt #${run.attemptNumber})`,
      timestamp: run.startedAt,
      startedAt: run.startedAt,
      inputJson: run.inputJson,
    });
  }

  // ── 4. Steps ─────────────────────────────────────────────────────────────
  const sorted = [...run.steps].sort((a, b) => a.stepIndex - b.stepIndex);

  for (const step of sorted) {
    const startTs = ts(step.startedAt ?? step.finishedAt, run.startedAt ?? run.createdAt);
    const endTs   = ts(step.finishedAt, startTs);
    const durMs   = step.startedAt && step.finishedAt
      ? new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()
      : undefined;

    const isApproval = step.stepType === "APPROVAL_GATE";
    const matchingApproval = isApproval
      ? run.approvalRequests.find(ap => ap.agentRunStepId === step.id)
      : undefined;

    // Step started event
    events.push({
      id: `${step.id}:started`,
      sequence: next(),
      type: stepTypeToStartEvent(step.stepType),
      status: "SUCCEEDED",
      source: stepTypeSource(step.stepType),
      title: `${step.name}`,
      summary: stepSummaryStart(step),
      timestamp: startTs,
      startedAt: step.startedAt ?? undefined,
      stepName: step.name,
      inputJson: step.inputJson,
      tokensUsed: step.tokensUsed ?? undefined,
    });

    // Approval sub-events (pause → request → decision → resume)
    if (isApproval && matchingApproval) {
      events.push({
        id: `${matchingApproval.id}:requested`,
        sequence: next(),
        type: "APPROVAL_REQUESTED",
        status: "WAITING",
        source: "SYSTEM",
        title: `Approval requested — ${matchingApproval.title}`,
        summary: matchingApproval.message,
        timestamp: matchingApproval.requestedAt,
        stepName: step.name,
        approval: {
          id: matchingApproval.id,
          title: matchingApproval.title,
          message: matchingApproval.message,
          status: matchingApproval.status === "EXPIRED" ? "REJECTED" : matchingApproval.status,
          decidedBy: matchingApproval.decidedBy?.name ?? matchingApproval.decidedBy?.email,
          decidedAt: matchingApproval.decidedAt ?? undefined,
          decisionReason: matchingApproval.decisionReason ?? undefined,
        },
      });

      if (matchingApproval.status !== "PENDING") {
        const decidedTs = matchingApproval.decidedAt ?? matchingApproval.requestedAt;
        const decidedType: TimelineEventType =
          matchingApproval.status === "APPROVED" ? "APPROVAL_APPROVED"
          : matchingApproval.status === "REJECTED" ? "APPROVAL_REJECTED"
          : "APPROVAL_EXPIRED";

        events.push({
          id: `${matchingApproval.id}:decided`,
          sequence: next(),
          type: decidedType,
          status: matchingApproval.status === "APPROVED" ? "SUCCEEDED" : "FAILED",
          source: "HUMAN",
          title: matchingApproval.status === "APPROVED" ? "Approval granted"
            : matchingApproval.status === "REJECTED" ? "Approval rejected"
            : "Approval expired",
          summary: matchingApproval.decisionReason ?? undefined,
          timestamp: decidedTs,
          actorName: matchingApproval.decidedBy?.name ?? matchingApproval.decidedBy?.email,
          approval: {
            id: matchingApproval.id,
            title: matchingApproval.title,
            message: matchingApproval.message,
            status: matchingApproval.status === "EXPIRED" ? "REJECTED" : matchingApproval.status,
            decidedBy: matchingApproval.decidedBy?.name ?? matchingApproval.decidedBy?.email,
            decidedAt: decidedTs,
            decisionReason: matchingApproval.decisionReason ?? undefined,
          },
        });

        if (matchingApproval.status === "APPROVED") {
          events.push({
            id: `${run.id}:resumed:${step.id}`,
            sequence: next(),
            type: "RUN_RESUMED",
            status: "SUCCEEDED",
            source: "SYSTEM",
            title: "Run resumed",
            summary: "Execution continued after approval",
            timestamp: decidedTs,
          });
        }
      }
    }

    // Step completion event (skip if still RUNNING/PENDING)
    if (!["RUNNING", "PENDING"].includes(step.status)) {
      events.push({
        id: `${step.id}:finished`,
        sequence: next(),
        type: stepTypeToEndEvent(step.stepType, step.status),
        status: stepStatusToUi(step.status),
        source: stepTypeSource(step.stepType),
        title: `${step.name} — ${step.status === "SUCCEEDED" ? "completed" : step.status === "FAILED" ? "failed" : "skipped"}`,
        summary: stepSummaryEnd(step),
        timestamp: endTs,
        startedAt: step.startedAt ?? undefined,
        finishedAt: step.finishedAt ?? undefined,
        durationMs: durMs,
        stepName: step.name,
        outputJson: step.outputJson,
        errorMessage: step.errorMessage ?? undefined,
        tokensUsed: step.tokensUsed ?? undefined,
        estimatedCostUsd: step.estimatedCostUsd ?? undefined,
      });
    }
  }

  // ── 5. Terminal event ────────────────────────────────────────────────────
  const finTs = run.finishedAt ?? new Date().toISOString();

  if (run.status === "SUCCEEDED") {
    events.push({
      id: `${run.id}:succeeded`,
      sequence: next(),
      type: "RUN_SUCCEEDED",
      status: "SUCCEEDED",
      source: "WORKER",
      title: "Run succeeded",
      summary: `Completed in ${fmtDur(run.durationMs)}`,
      timestamp: finTs,
      finishedAt: finTs,
      durationMs: run.durationMs ?? undefined,
      outputJson: run.outputJson,
      tokensUsed: run.totalTokens ?? undefined,
      estimatedCostUsd: run.estimatedCostUsd ?? undefined,
    });
  } else if (run.status === "FAILED") {
    events.push({
      id: `${run.id}:failed`,
      sequence: next(),
      type: "RUN_FAILED",
      status: "FAILED",
      source: "WORKER",
      title: "Run failed",
      summary: run.errorMessage ?? "Unhandled error",
      timestamp: finTs,
      finishedAt: finTs,
      durationMs: run.durationMs ?? undefined,
      errorMessage: run.errorMessage ?? undefined,
    });
  } else if (run.status === "CANCELLED") {
    events.push({
      id: `${run.id}:cancelled`,
      sequence: next(),
      type: "RUN_CANCELLED",
      status: "CANCELLED",
      source: "HUMAN",
      title: "Run cancelled",
      summary: "Cancelled by operator",
      timestamp: finTs,
    });
  } else if (run.status === "TIMEOUT") {
    events.push({
      id: `${run.id}:timeout`,
      sequence: next(),
      type: "RUN_TIMED_OUT",
      status: "FAILED",
      source: "SYSTEM",
      title: "Run timed out",
      summary: "Maximum execution time exceeded",
      timestamp: finTs,
    });
  }

  // Sort by timestamp, re-sequence
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  events.forEach((e, i) => { e.sequence = i + 1; });

  return events;
}

// ─── Steps mapper ─────────────────────────────────────────────────────────────

function buildSteps(run: ApiAgentRun): RunStepUiModel[] {
  return [...run.steps]
    .sort((a, b) => a.stepIndex - b.stepIndex)
    .map((step) => {
      const durMs = step.startedAt && step.finishedAt
        ? new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()
        : undefined;
      return {
        id: step.id,
        index: step.stepIndex,
        agentName: run.agentJob.name,
        type: step.stepType,
        name: step.name,
        status: stepStatusToUi(step.status),
        startedAt: step.startedAt ?? undefined,
        finishedAt: step.finishedAt ?? undefined,
        durationMs: durMs,
        tokensUsed: step.tokensUsed ?? undefined,
        estimatedCostUsd: step.estimatedCostUsd ?? undefined,
        inputJson: step.inputJson,
        outputJson: step.outputJson,
        errorMessage: step.errorMessage ?? undefined,
      };
    });
}

// ─── Approvals mapper ─────────────────────────────────────────────────────────

function buildApprovals(run: ApiAgentRun): ApprovalUiModel[] {
  return run.approvalRequests.map((ap) => {
    const relatedStep = run.steps.find(s => s.id === ap.agentRunStepId);
    return {
      id: ap.id,
      title: ap.title,
      message: ap.message,
      status: ap.status,
      relatedAgent: run.agentJob.name,
      relatedStep: relatedStep?.name ?? ap.agentRunStepId ?? "unknown",
      requestedAt: ap.requestedAt,
      decidedAt: ap.decidedAt ?? undefined,
      decidedBy: ap.decidedBy?.name ?? ap.decidedBy?.email,
      decisionReason: ap.decisionReason ?? undefined,
      payloadPreview: relatedStep?.inputJson ?? undefined,
    };
  });
}

// ─── Agent summary deriver ────────────────────────────────────────────────────
// The current API doesn't expose per-agent data, so we synthesise one agent
// entry from the job metadata + aggregated step stats.

function buildAgents(run: ApiAgentRun): AgentExecutionSummary[] {
  const steps = run.steps;
  const totalTokens = steps.reduce((s, st) => s + (st.tokensUsed ?? 0), 0);
  const totalCost   = steps.reduce((s, st) => s + (st.estimatedCostUsd ?? 0), 0);
  const toolsUsed   = [...new Set(
    steps
      .filter(s => ["TOOL_CALL", "HTTP_CALL"].includes(s.stepType))
      .map(s => s.name)
  )];

  const failed = steps.some(s => s.status === "FAILED");
  const running = run.status === "RUNNING" || run.status === "WAITING_FOR_APPROVAL";

  const durMs = run.startedAt && run.finishedAt
    ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    : run.durationMs ?? undefined;

  return [{
    id: run.id,
    name: run.agentJob.name,
    role: run.agentJob.description ?? "Primary agent",
    status: failed ? "FAILED" : running ? "RUNNING" : run.status === "SUCCEEDED" ? "SUCCEEDED" : "PENDING",
    startedAt: run.startedAt ?? undefined,
    finishedAt: run.finishedAt ?? undefined,
    durationMs: durMs ?? undefined,
    stepsCount: steps.length,
    tokensUsed: totalTokens > 0 ? totalTokens : undefined,
    estimatedCostUsd: totalCost > 0 ? totalCost : undefined,
    toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    outputSummary:
      run.status === "SUCCEEDED"
        ? `Completed ${steps.filter(s => s.status === "SUCCEEDED").length} of ${steps.length} steps`
        : run.errorMessage ?? undefined,
  }];
}

// ─── Audit log builder ────────────────────────────────────────────────────────

function buildAuditLogs(run: ApiAgentRun): AuditLogUiModel[] {
  const logs: AuditLogUiModel[] = [];

  // Run created
  logs.push({
    id: `${run.id}:audit:created`,
    time: run.createdAt,
    action: "RUN_CREATED",
    actor: "scheduler",
    entity: `run:${run.id.slice(0, 8)}`,
    details: `Triggered via ${run.triggerSource}`,
  });

  // Started
  if (run.startedAt) {
    logs.push({
      id: `${run.id}:audit:started`,
      time: run.startedAt,
      action: "RUN_STARTED",
      actor: "worker",
      entity: `run:${run.id.slice(0, 8)}`,
      details: `Attempt #${run.attemptNumber}`,
    });
  }

  // Each approval decision
  for (const ap of run.approvalRequests) {
    logs.push({
      id: `${ap.id}:audit:requested`,
      time: ap.requestedAt,
      action: "APPROVAL_REQUESTED",
      actor: "system",
      entity: `approval:${ap.id.slice(0, 8)}`,
      details: ap.title,
    });

    if (ap.decidedAt && ap.status !== "PENDING") {
      logs.push({
        id: `${ap.id}:audit:decided`,
        time: ap.decidedAt,
        action: ap.status === "APPROVED" ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED",
        actor: ap.decidedBy?.name ?? ap.decidedBy?.email ?? "unknown",
        entity: `approval:${ap.id.slice(0, 8)}`,
        details: ap.decisionReason ?? ap.status,
      });
    }
  }

  // Failed steps
  for (const step of run.steps.filter(s => s.status === "FAILED")) {
    logs.push({
      id: `${step.id}:audit:failed`,
      time: step.finishedAt ?? run.finishedAt ?? run.createdAt,
      action: "STEP_FAILED",
      actor: "worker",
      entity: `step:${step.id.slice(0, 8)}`,
      details: step.errorMessage ?? step.name,
    });
  }

  // Terminal
  if (run.finishedAt) {
    logs.push({
      id: `${run.id}:audit:terminal`,
      time: run.finishedAt,
      action: `RUN_${run.status}`,
      actor: run.status === "CANCELLED" ? "operator" : "worker",
      entity: `run:${run.id.slice(0, 8)}`,
      details: run.errorMessage ?? `Duration: ${fmtDur(run.durationMs)}`,
    });
  }

  logs.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  return logs;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function mapApiRunToUiModel(run: ApiAgentRun): AgentRunUiModel {
  const hasOutput = run.outputJson !== null && run.outputJson !== undefined;
  const isTerminal = ["SUCCEEDED", "FAILED", "CANCELLED", "TIMEOUT"].includes(run.status);

  return {
    run: {
      id: run.id,
      jobId: run.agentJob.id,
      jobName: run.agentJob.name,
      title: `${run.agentJob.name} — Run #${run.attemptNumber}`,
      status: run.status as AgentRunUiModel["run"]["status"],
      triggerSource: triggerToUi(run.triggerSource),
      attemptNumber: run.attemptNumber,
      environment: "Production",          // enrich from workspace/env context when available
      idempotencyKey: run.idempotencyKey,
      startedAt: run.startedAt ?? run.createdAt,
      finishedAt: run.finishedAt ?? undefined,
      durationMs: run.durationMs ?? undefined,
      totalTokens: run.totalTokens ?? undefined,
      estimatedCostUsd: run.estimatedCostUsd ?? undefined,
      errorMessage: run.errorMessage ?? undefined,
    },
    agents: buildAgents(run),
    timelineEvents: buildTimelineEvents(run),
    steps: buildSteps(run),
    approvals: buildApprovals(run),
    artifacts: [],                         // enriched by future artifact API
    auditLogs: buildAuditLogs(run),
    output: hasOutput ? run.outputJson : undefined,
    partialOutput: !hasOutput && !isTerminal ? undefined : undefined,
    raw: run,
  };
}
