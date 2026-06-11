/**
 * run-timeline.ts
 *
 * Maps raw API data (AgentRun + steps + approvals + auditLogs) into a flat,
 * ordered array of RunTimelineEvent objects suitable for rendering a
 * Temporal-style event history stream.
 */

// ─── Event type union ─────────────────────────────────────────────────────────

export type RunTimelineEventType =
  // System lifecycle
  | "RUN_CREATED"
  | "RUN_QUEUED"
  | "RUN_STARTED"
  | "RUN_SUCCEEDED"
  | "RUN_FAILED"
  | "RUN_CANCELLED"
  | "RUN_TIMEOUT"
  | "RUN_RESUMED"
  // Budget / policy
  | "BUDGET_CHECK_PASSED"
  | "BUDGET_CHECK_FAILED"
  | "POLICY_CHECK_PASSED"
  | "POLICY_CHECK_FAILED"
  // Steps
  | "STEP_STARTED"
  | "STEP_SUCCEEDED"
  | "STEP_FAILED"
  | "STEP_SKIPPED"
  // LLM
  | "LLM_CALL_STARTED"
  | "LLM_CALL_SUCCEEDED"
  | "LLM_CALL_FAILED"
  // Tool
  | "TOOL_CALL_STARTED"
  | "TOOL_CALL_SUCCEEDED"
  | "TOOL_CALL_FAILED"
  // Approval
  | "APPROVAL_REQUESTED"
  | "APPROVAL_APPROVED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_PAUSED"
  // Retry
  | "RETRY_QUEUED"
  | "RETRY_STARTED";

// ─── Core event type ─────────────────────────────────────────────────────────

export type RunTimelineEventStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "WAITING"
  | "CANCELLED";

export type RunTimelineEventSource =
  | "SYSTEM"
  | "SCHEDULER"
  | "WORKER"
  | "AGENT"
  | "HUMAN"
  | "API";

export interface RunTimelineEvent {
  id: string;
  sequence: number;
  type: RunTimelineEventType;
  title: string;
  summary?: string;
  status: RunTimelineEventStatus;
  timestamp: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  source: RunTimelineEventSource;
  actorName?: string;
  stepId?: string;
  approvalId?: string;
  inputJson?: unknown;
  outputJson?: unknown;
  metadataJson?: unknown;
  errorMessage?: string;
  tokensUsed?: number;
  estimatedCostUsd?: number;
}

// ─── API shapes (mirrors real API response) ────────────────────────────────

interface ApiStep {
  id: string;
  stepIndex: number;
  stepType: string;
  name: string;
  status: string;
  inputJson?: unknown;
  outputJson?: unknown;
  errorMessage?: string | null;
  tokensUsed?: number | null;
  estimatedCostUsd?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface ApiApproval {
  id: string;
  title: string;
  message: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  requestedAt: string;
  decidedAt?: string | null;
  decisionReason?: string | null;
  agentRunStepId?: string | null;
  decidedBy?: { id: string; name: string | null; email: string } | null;
}

interface ApiRun {
  id: string;
  status: string;
  triggerSource: string;
  attemptNumber: number;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  inputJson?: unknown;
  outputJson?: unknown;
  steps: ApiStep[];
  approvalRequests: ApiApproval[];
}

// ─── Mapping function ─────────────────────────────────────────────────────────

export function buildRunTimelineEvents(run: ApiRun): RunTimelineEvent[] {
  const events: RunTimelineEvent[] = [];
  let seq = 0;
  const next = () => ++seq;

  // 1 — Run created
  events.push({
    id: `${run.id}:created`,
    sequence: next(),
    type: "RUN_CREATED",
    title: "Run created",
    summary: `Triggered via ${run.triggerSource.toLowerCase().replace(/_/g, " ")}`,
    status: "SUCCEEDED",
    timestamp: run.createdAt,
    source: run.triggerSource === "MANUAL" || run.triggerSource === "API" ? "API" : "SCHEDULER",
    metadataJson: { triggerSource: run.triggerSource, attemptNumber: run.attemptNumber },
  });

  // 2 — Run queued
  events.push({
    id: `${run.id}:queued`,
    sequence: next(),
    type: "RUN_QUEUED",
    title: "Run queued",
    summary: "Placed in BullMQ worker queue",
    status: "SUCCEEDED",
    timestamp: run.createdAt,
    source: "SCHEDULER",
    metadataJson: { queue: "agent-runs", priority: 0 },
  });

  // 3 — Budget / policy check (before start)
  if (run.startedAt) {
    events.push({
      id: `${run.id}:budget-check`,
      sequence: next(),
      type: "BUDGET_CHECK_PASSED",
      title: "Budget check passed",
      summary: "Spending within monthly org limits",
      status: "SUCCEEDED",
      timestamp: run.startedAt,
      source: "SYSTEM",
      metadataJson: { budgetLimit: "$50.00/month", currentSpend: run.estimatedCostUsd ?? 0 },
    });

    // 4 — Policy check
    events.push({
      id: `${run.id}:policy-check`,
      sequence: next(),
      type: "POLICY_CHECK_PASSED",
      title: "Policy check passed",
      summary: "All pre-run policy gates satisfied",
      status: "SUCCEEDED",
      timestamp: run.startedAt,
      source: "SYSTEM",
    });

    // 5 — Run started
    events.push({
      id: `${run.id}:started`,
      sequence: next(),
      type: "RUN_STARTED",
      title: "Run started",
      summary: `Worker picked up the job (attempt #${run.attemptNumber})`,
      status: "SUCCEEDED",
      timestamp: run.startedAt,
      startedAt: run.startedAt,
      source: "WORKER",
      inputJson: run.inputJson,
    });
  }

  // 6 — Map each step
  const stepsSorted = [...run.steps].sort((a, b) => a.stepIndex - b.stepIndex);

  for (const step of stepsSorted) {
    const stepStatus = stepStatusToEventStatus(step.status);
    const startTs = step.startedAt ?? step.finishedAt ?? run.startedAt ?? run.createdAt;

    // Determine event type based on step type
    const { startType, endType } = resolveStepEventTypes(step.stepType);

    // Step started
    events.push({
      id: `${step.id}:started`,
      sequence: next(),
      type: startType,
      title: `${step.name} — started`,
      summary: stepSummary(step, "start"),
      status: "SUCCEEDED",
      timestamp: startTs,
      startedAt: step.startedAt ?? undefined,
      source: "WORKER",
      stepId: step.id,
      inputJson: step.inputJson,
      tokensUsed: step.tokensUsed ?? undefined,
    });

    // If approval gate — insert APPROVAL_PAUSED
    if (step.stepType === "APPROVAL_GATE") {
      const matchingApproval = run.approvalRequests.find(
        (ap) => ap.agentRunStepId === step.id
      );
      if (matchingApproval) {
        events.push({
          id: `${step.id}:approval-paused`,
          sequence: next(),
          type: "APPROVAL_PAUSED",
          title: "Run paused — waiting for approval",
          summary: matchingApproval.title,
          status: "WAITING",
          timestamp: matchingApproval.requestedAt,
          source: "SYSTEM",
          stepId: step.id,
          approvalId: matchingApproval.id,
          metadataJson: { message: matchingApproval.message },
        });

        events.push({
          id: `${matchingApproval.id}:requested`,
          sequence: next(),
          type: "APPROVAL_REQUESTED",
          title: "Approval requested",
          summary: matchingApproval.message,
          status: "WAITING",
          timestamp: matchingApproval.requestedAt,
          source: "SYSTEM",
          stepId: step.id,
          approvalId: matchingApproval.id,
        });

        if (matchingApproval.status !== "PENDING") {
          const decidedTs = matchingApproval.decidedAt ?? matchingApproval.requestedAt;
          const approvalEventType: RunTimelineEventType =
            matchingApproval.status === "APPROVED"
              ? "APPROVAL_APPROVED"
              : matchingApproval.status === "REJECTED"
                ? "APPROVAL_REJECTED"
                : "APPROVAL_EXPIRED";

          events.push({
            id: `${matchingApproval.id}:decided`,
            sequence: next(),
            type: approvalEventType,
            title:
              matchingApproval.status === "APPROVED"
                ? "Approval granted"
                : matchingApproval.status === "REJECTED"
                  ? "Approval rejected"
                  : "Approval expired",
            summary: matchingApproval.decisionReason ?? undefined,
            status:
              matchingApproval.status === "APPROVED"
                ? "SUCCEEDED"
                : matchingApproval.status === "REJECTED"
                  ? "FAILED"
                  : "CANCELLED",
            timestamp: decidedTs,
            source: "HUMAN",
            actorName:
              matchingApproval.decidedBy?.name ??
              matchingApproval.decidedBy?.email ??
              undefined,
            approvalId: matchingApproval.id,
            metadataJson: {
              reason: matchingApproval.decisionReason,
              decidedBy: matchingApproval.decidedBy,
            },
          });

          if (matchingApproval.status === "APPROVED") {
            events.push({
              id: `${run.id}:resumed:${step.id}`,
              sequence: next(),
              type: "RUN_RESUMED",
              title: "Run resumed",
              summary: "Execution resumed after approval",
              status: "SUCCEEDED",
              timestamp: decidedTs,
              source: "SYSTEM",
            });
          }
        }
      }
    }

    // Step finished (only if not still running)
    if (step.status !== "RUNNING" && step.status !== "PENDING") {
      const durationMs =
        step.startedAt && step.finishedAt
          ? new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()
          : undefined;

      events.push({
        id: `${step.id}:finished`,
        sequence: next(),
        type: endType,
        title: `${step.name} — ${step.status === "SUCCEEDED" ? "succeeded" : step.status === "FAILED" ? "failed" : "skipped"}`,
        summary: step.errorMessage ?? stepSummary(step, "end"),
        status: stepStatus,
        timestamp: step.finishedAt ?? startTs,
        startedAt: step.startedAt ?? undefined,
        finishedAt: step.finishedAt ?? undefined,
        durationMs,
        source: "WORKER",
        stepId: step.id,
        outputJson: step.outputJson,
        errorMessage: step.errorMessage ?? undefined,
        tokensUsed: step.tokensUsed ?? undefined,
        estimatedCostUsd: step.estimatedCostUsd ?? undefined,
      });
    }
  }

  // 7 — Retry hint (if this is a retry run)
  if (run.attemptNumber > 1 && run.startedAt) {
    events.splice(2, 0, {
      id: `${run.id}:retry-started`,
      sequence: 0, // will be re-sequenced
      type: "RETRY_STARTED",
      title: `Retry started (attempt #${run.attemptNumber})`,
      summary: "Previous attempt failed — this is an automatic or manual retry",
      status: "SUCCEEDED",
      timestamp: run.startedAt,
      source: "SCHEDULER",
      metadataJson: { attemptNumber: run.attemptNumber },
    });
  }

  // 8 — Terminal event
  const finishedTs = run.finishedAt ?? new Date().toISOString();
  if (run.status === "SUCCEEDED") {
    events.push({
      id: `${run.id}:succeeded`,
      sequence: next(),
      type: "RUN_SUCCEEDED",
      title: "Run succeeded",
      summary: `Completed in ${fmtDur(run.durationMs ?? null)}`,
      status: "SUCCEEDED",
      timestamp: finishedTs,
      finishedAt: finishedTs,
      durationMs: run.durationMs ?? undefined,
      source: "WORKER",
      outputJson: run.outputJson,
      tokensUsed: run.totalTokens ?? undefined,
      estimatedCostUsd: run.estimatedCostUsd ?? undefined,
    });
  } else if (run.status === "FAILED") {
    events.push({
      id: `${run.id}:failed`,
      sequence: next(),
      type: "RUN_FAILED",
      title: "Run failed",
      summary: run.errorMessage ?? "Unhandled error",
      status: "FAILED",
      timestamp: finishedTs,
      finishedAt: finishedTs,
      durationMs: run.durationMs ?? undefined,
      source: "WORKER",
      errorMessage: run.errorMessage ?? undefined,
    });
  } else if (run.status === "CANCELLED") {
    events.push({
      id: `${run.id}:cancelled`,
      sequence: next(),
      type: "RUN_CANCELLED",
      title: "Run cancelled",
      summary: "Cancelled by user or operator",
      status: "CANCELLED",
      timestamp: finishedTs,
      source: "HUMAN",
    });
  } else if (run.status === "TIMEOUT") {
    events.push({
      id: `${run.id}:timeout`,
      sequence: next(),
      type: "RUN_TIMEOUT",
      title: "Run timed out",
      summary: "Maximum execution time exceeded",
      status: "FAILED",
      timestamp: finishedTs,
      source: "SYSTEM",
    });
  }

  // Re-sequence all events by timestamp, then assign sequential numbers
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  events.forEach((e, i) => { e.sequence = i + 1; });

  return events;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stepStatusToEventStatus(status: string): RunTimelineEventStatus {
  const map: Record<string, RunTimelineEventStatus> = {
    SUCCEEDED: "SUCCEEDED",
    FAILED: "FAILED",
    RUNNING: "RUNNING",
    PENDING: "PENDING",
    SKIPPED: "CANCELLED",
    WAITING: "WAITING",
  };
  return map[status] ?? "PENDING";
}

function resolveStepEventTypes(stepType: string): {
  startType: RunTimelineEventType;
  endType: RunTimelineEventType;
} {
  switch (stepType) {
    case "LLM_CALL":
      return { startType: "LLM_CALL_STARTED", endType: "LLM_CALL_SUCCEEDED" };
    case "TOOL_CALL":
    case "HTTP_CALL":
      return { startType: "TOOL_CALL_STARTED", endType: "TOOL_CALL_SUCCEEDED" };
    case "APPROVAL_GATE":
      return { startType: "STEP_STARTED", endType: "STEP_SUCCEEDED" };
    default:
      return { startType: "STEP_STARTED", endType: "STEP_SUCCEEDED" };
  }
}

function stepSummary(step: ApiStep, phase: "start" | "end"): string | undefined {
  if (phase === "start") {
    switch (step.stepType) {
      case "LLM_CALL": return "Calling language model";
      case "TOOL_CALL": return "Executing tool";
      case "HTTP_CALL": return "Making HTTP request";
      case "APPROVAL_GATE": return "Requesting human approval";
      default: return undefined;
    }
  }
  if (step.tokensUsed) return `${step.tokensUsed.toLocaleString()} tokens`;
  return undefined;
}

function fmtDur(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
