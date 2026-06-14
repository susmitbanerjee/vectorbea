/**
 * Maps platform AgentRun + RunEvent[] → AgentRunUiModel for the run detail UI.
 * Decouples the domain model from the timeline/event display model.
 */

import type { AgentRun, RunEvent } from "@/types/platform";
import type {
  AgentRunUiModel,
  RunTimelineEventUi,
  ApprovalUiModel,
  AgentExecutionSummary,
  RunStepUiModel,
  ArtifactUiModel,
  AuditLogUiModel,
} from "@/types/agent-run-ui";

function mapRunStatus(s: AgentRun["status"]): AgentRunUiModel["run"]["status"] {
  const map: Record<AgentRun["status"], AgentRunUiModel["run"]["status"]> = {
    queued:               "QUEUED",
    running:              "RUNNING",
    waiting_for_approval: "WAITING_FOR_APPROVAL",
    paused:               "RUNNING",
    succeeded:            "SUCCEEDED",
    failed:               "FAILED",
    cancelled:            "CANCELLED",
    timed_out:            "TIMEOUT",
  };
  return map[s] ?? "QUEUED";
}

function mapTrigger(t: AgentRun["triggerType"]): AgentRunUiModel["run"]["triggerSource"] {
  if (t === "cron") return "SCHEDULE";
  if (t === "manual" || t === "api") return "MANUAL";
  return "MANUAL";
}

function mapEventStatus(s: RunEvent["status"]): RunTimelineEventUi["status"] {
  if (s === "error") return "FAILED";
  if (s === "pending") return "WAITING";
  return "SUCCEEDED";
}

function mapEventSource(s: RunEvent["source"]): RunTimelineEventUi["source"] {
  const map: Record<string, RunTimelineEventUi["source"]> = {
    native:       "SYSTEM",
    imported:     "SYSTEM",
    instrumented: "WORKER",
    endpoint_only:"API",
  };
  return map[s] ?? "SYSTEM";
}

function eventTitle(evt: RunEvent): string {
  // Use runtime-provided title if available
  if (evt.title) return evt.title;
  switch (evt.type) {
    case "RUN_CREATED":           return "Run created";
    case "RUN_QUEUED":            return "Run queued";
    case "RUN_STARTED":           return "Run started";
    case "RUN_SUCCEEDED":         return "Run succeeded";
    case "RUN_FAILED":            return "Run failed";
    case "RUN_RESUMED":           return "Run resumed";
    case "AGENT_STARTED":         return `Agent started${evt.agentName ? ` — ${evt.agentName}` : ""}`;
    case "AGENT_COMPLETED":       return `Agent completed${evt.agentName ? ` — ${evt.agentName}` : ""}`;
    case "AGENT_FAILED":          return `Agent failed${evt.agentName ? ` — ${evt.agentName}` : ""}`;
    case "AGENT_HANDOFF":         return `Handoff${evt.agentName ? ` → ${evt.agentName}` : ""}`;
    case "AGENT_PLAN_CREATED":    return "Agent plan created";
    case "LLM_CALL_STARTED":      return `LLM call${evt.modelName ? ` — ${evt.modelName}` : ""}`;
    case "LLM_CALL_COMPLETED":    return `LLM call completed${evt.tokens ? ` (${evt.tokens.toLocaleString()} tokens)` : ""}`;
    case "LLM_OUTPUT_VALIDATED":  return "LLM output validated";
    case "TOOL_CALL_STARTED":     return `Tool call — ${evt.toolName ?? "unknown"}`;
    case "TOOL_CALL_COMPLETED":   return `Tool completed — ${evt.toolName ?? "unknown"}`;
    case "TOOL_CALL_FAILED":      return `Tool failed — ${evt.toolName ?? "unknown"}`;
    case "APPROVAL_REQUESTED":    return "Approval requested";
    case "APPROVAL_APPROVED":     return "Approval approved";
    case "APPROVAL_REJECTED":     return "Approval rejected";
    case "CHECKPOINT_CREATED":    return "Checkpoint saved";
    case "ARTIFACT_CREATED":      return "Artifact created";
    case "RETRY_SCHEDULED":       return "Retry scheduled";
    case "RETRY_STARTED":         return "Retry attempt";
    case "RETRY_EXHAUSTED":       return "Retries exhausted";
    case "STEP_SCHEDULED":        return "Step scheduled";
    case "STEP_STARTED":          return "Step started";
    case "STEP_COMPLETED":        return "Step completed";
    case "STEP_FAILED":           return "Step failed";
    default:                      return (evt.type as string).replace(/_/g, " ").toLowerCase();
  }
}

export function mapRunToUiModel(run: AgentRun, events: RunEvent[]): AgentRunUiModel {
  // Timeline events
  const timelineEvents: RunTimelineEventUi[] = events.map((evt, idx) => {
    const startMs = new Date(evt.timestamp).getTime();
    return {
      id: evt.id,
      sequence: idx + 1,
      type: evt.type as RunTimelineEventUi["type"],
      status: mapEventStatus(evt.status),
      source: mapEventSource(evt.source),
      title: eventTitle(evt),
      timestamp: evt.timestamp,
      startedAt: evt.timestamp,
      finishedAt: evt.durationMs ? new Date(startMs + evt.durationMs).toISOString() : undefined,
      durationMs: evt.durationMs,
      agentName: evt.agentName,
      toolName: evt.toolName,
      modelName: evt.modelName,
      tokensUsed: evt.tokens,
      estimatedCostUsd: evt.cost,
      errorMessage: evt.error,
      inputJson: evt.input,
      outputJson: evt.output,
      metadataJson: evt.metadata,
      approval: evt.type === "APPROVAL_REQUESTED"
        ? { id: `approval-${evt.id}`, title: "Approval Required", message: "This step requires human approval.", status: "PENDING" }
        : undefined,
    };
  });

  // Derive agent summaries from events
  const agentNames = [...new Set(events.filter((e) => e.agentName).map((e) => e.agentName!))];
  const agents: AgentExecutionSummary[] = agentNames.map((name) => {
    const agentEvents = events.filter((e) => e.agentName === name);
    const started = agentEvents.find((e) => e.type === "AGENT_STARTED");
    const completed = agentEvents.find((e) => e.type === "AGENT_COMPLETED" || e.type === "AGENT_FAILED");
    const totalTokens = agentEvents.reduce((s, e) => s + (e.tokens ?? 0), 0);
    const totalCost = agentEvents.reduce((s, e) => s + (e.cost ?? 0), 0);
    const toolsUsed = [...new Set(agentEvents.filter((e) => e.toolName).map((e) => e.toolName!))];

    return {
      id: `agent-${name.toLowerCase().replace(/\s+/g, "-")}`,
      name,
      role: name,
      status: completed?.type === "AGENT_FAILED" ? "FAILED" : completed ? "SUCCEEDED" : "RUNNING",
      startedAt: started?.timestamp,
      finishedAt: completed?.timestamp,
      durationMs: completed?.durationMs,
      stepsCount: agentEvents.length,
      tokensUsed: totalTokens || undefined,
      estimatedCostUsd: totalCost || undefined,
      toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    };
  });

  // Approvals
  const approvals: ApprovalUiModel[] = run.approvalGates.map((gate) => ({
    id: gate.id,
    title: `Approval Required — ${gate.stepName}`,
    message: `This step is paused and requires a human decision before the run can proceed.`,
    status: gate.status === "pending" ? "PENDING" : gate.status === "approved" ? "APPROVED" : gate.status === "rejected" ? "REJECTED" : "EXPIRED",
    relatedAgent: run.currentAgentId ?? "system",
    relatedStep: gate.stepId,
    requestedAt: gate.requestedAt,
    decidedAt: gate.decidedAt,
    decidedBy: gate.decidedBy,
    decisionReason: gate.reason,
    payloadPreview: gate.context,
  }));

  // Artifacts
  const artifacts: ArtifactUiModel[] = run.artifacts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.contentType.includes("json") ? "json" : a.contentType.includes("markdown") ? "markdown" : "text",
    createdByAgent: "system",
    createdAt: a.createdAt,
    sizeLabel: a.sizeBytes > 1024 ? `${(a.sizeBytes / 1024).toFixed(1)} KB` : `${a.sizeBytes} B`,
    preview: a.preview ? JSON.parse(a.preview) : undefined,
  }));

  // Audit logs (basic)
  const auditLogs: AuditLogUiModel[] = events
    .filter((e) => e.type.startsWith("APPROVAL_") || e.type === "RUN_FAILED" || e.type === "RUN_SUCCEEDED")
    .map((e) => ({
      id: e.id,
      time: e.timestamp,
      action: e.type,
      actor: e.agentName ?? "system",
      entity: run.workflowName,
      details: e.error ?? eventTitle(e),
    }));

  return {
    run: {
      id: run.id,
      jobId: run.workflowId,
      jobName: run.workflowName,
      title: run.workflowName,
      status: mapRunStatus(run.status),
      triggerSource: mapTrigger(run.triggerType),
      attemptNumber: 1,
      environment: "Production",
      idempotencyKey: run.idempotencyKey ?? `idem-${run.id}`,
      startedAt: run.startedAt ?? run.createdAt,
      finishedAt: run.completedAt ?? undefined,
      durationMs: run.durationMs ?? undefined,
      totalTokens: run.totalTokens ?? undefined,
      estimatedCostUsd: run.estimatedCostUsd ?? undefined,
      errorMessage: run.error,
    },
    agents,
    timelineEvents,
    steps: [],
    approvals,
    artifacts,
    auditLogs,
    input: run.input,
    output: run.output,
    runMetadata: {
      searchAttributes: {
        workflowId: run.workflowId,
        workflowVersion: run.workflowVersion,
        creationMode: run.creationMode,
      },
      aiMetadata: {
        primaryModel: agents[0]?.name ?? "gpt-4.1-mini",
      },
      budgetMetadata: {},
      retryPolicy: { maxAttempts: 2 },
      executionMetadata: { workerId: "worker-001" },
    },
  };
}
