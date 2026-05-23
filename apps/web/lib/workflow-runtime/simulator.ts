/**
 * Vectorbee Workflow Runtime Simulator
 *
 * Takes a saved workflow definition and a queued AgentRun, then generates a
 * realistic, persisted set of RunEvents + an updated AgentRun.
 *
 * Supports:
 *  - Approval pause / resume
 *  - Agent step failure + retry events (30% failure when maxAttempts > 1)
 *  - Checkpoints
 *  - Replay (REPLAY_STARTED → continue from step index)
 *  - Rich event titles
 */

import type {
  Workflow,
  WorkflowStep,
  AgentRun,
  RunEvent,
  RunEventType,
  RunCheckpoint,
  ApprovalGate,
  Agent,
  Tool,
} from "@/types/platform";

// ─── ID helpers ───────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextEvtId(): string {
  return `evt-sim-${Date.now()}-${++_idCounter}`;
}

// ─── Event title map ──────────────────────────────────────────────────────────

const EVENT_TITLES: Partial<Record<RunEventType, string>> = {
  RUN_CREATED: "Run created",
  RUN_QUEUED: "Run queued",
  RUN_STARTED: "Run started",
  RUN_SUCCEEDED: "Run succeeded",
  RUN_FAILED: "Run failed",
  RUN_RESUMED: "Run resumed",
  REPLAY_STARTED: "Replay started",
  STEP_SCHEDULED: "Step scheduled",
  STEP_STARTED: "Step started",
  STEP_COMPLETED: "Step completed",
  STEP_FAILED: "Step failed",
  AGENT_PLAN_CREATED: "Agent plan created",
  LLM_OUTPUT_VALIDATED: "LLM output validated",
  APPROVAL_REQUESTED: "Approval requested",
  APPROVAL_APPROVED: "Approval approved",
  APPROVAL_REJECTED: "Approval rejected",
  CHECKPOINT_CREATED: "Checkpoint saved",
  ARTIFACT_CREATED: "Artifact created",
  RETRY_SCHEDULED: "Retry scheduled",
  RETRY_STARTED: "Retry attempt",
  RETRY_EXHAUSTED: "Retries exhausted",
};

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SimulationResult {
  updatedRun: AgentRun;
  events: RunEvent[];
  /** Index of the step that paused the run (approval / failure). -1 if completed. */
  pausedAtStepIndex: number;
}

function jitter(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

// ─── Core runner ──────────────────────────────────────────────────────────────

/**
 * Run the workflow from `startStepIndex` onward.
 * Appends to `existingEvents` (pass [] for a fresh run).
 */
export function runWorkflowFromStep(
  workflow: Workflow,
  run: AgentRun,
  agents: Agent[],
  tools: Tool[],
  existingEvents: RunEvent[],
  startStepIndex: number,
  options: { isResume?: boolean; isReplay?: boolean } = {},
): SimulationResult {
  const events: RunEvent[] = [...existingEvents];
  let sequence = events.length;
  const startMs = new Date(run.createdAt).getTime();
  // Start timestamp after last existing event (or from run start)
  const lastEvt = events[events.length - 1];
  let ts = lastEvt ? new Date(lastEvt.timestamp).getTime() + jitter(100, 300) : startMs;

  let totalTokens = run.totalTokens ?? 0;
  let totalCost = run.estimatedCostUsd ?? 0;
  // Deep-copy existing state
  const checkpoints: RunCheckpoint[] = JSON.parse(JSON.stringify(run.checkpoints)) as RunCheckpoint[];
  const approvalGates: ApprovalGate[] = JSON.parse(JSON.stringify(run.approvalGates)) as ApprovalGate[];
  let runStatus: AgentRun["status"] = "running";
  let completedAt: string | null = null;
  let pausedAtStepIndex = -1;
  let currentStepId: string | undefined = run.currentStepId;

  // ── Event factory ────────────────────────────────────────────────────────────
  function emit(
    type: RunEventType,
    status: RunEvent["status"],
    extra: Partial<RunEvent> = {},
  ): RunEvent {
    const evtTitle = extra.title ?? EVENT_TITLES[type];
    const e: RunEvent = {
      id: nextEvtId(),
      runId: run.id,
      sequence: sequence++,
      timestamp: new Date(ts).toISOString(),
      type,
      status,
      source: "native",
      workflowId: workflow.id,
      workflowVersion: workflow.currentVersion,
      title: evtTitle,
      ...extra,
    };
    events.push(e);
    ts += jitter(40, 120);
    return e;
  }

  // ── Lifecycle events (only for fresh runs or resume/replay) ─────────────────
  if (startStepIndex === 0 && !options.isResume && !options.isReplay) {
    emit("RUN_CREATED", "ok");
    ts += 100;
    emit("RUN_QUEUED", "ok");
    ts += 200;
    emit("RUN_STARTED", "ok");
    ts += 300;
  } else if (options.isReplay) {
    emit("REPLAY_STARTED", "ok");
    ts += 200;
  } else if (options.isResume) {
    emit("RUN_RESUMED", "ok");
    ts += 200;
  }

  // ── Execute steps ────────────────────────────────────────────────────────────
  const steps = workflow.steps.filter((s) => s.type !== "end");

  for (let i = startStepIndex; i < steps.length; i++) {
    const step = steps[i]!;
    currentStepId = step.id;

    emit("STEP_SCHEDULED", "ok", { stepId: step.id });
    ts += 80;
    emit("STEP_STARTED", "ok", { stepId: step.id });
    ts += 150;

    const result = executeStep(step);

    if (result === "pause_approval") {
      pausedAtStepIndex = i;
      return buildResult();
    }

    if (result === "failed") {
      pausedAtStepIndex = i;
      return buildResult();
    }

    // STEP_COMPLETED (branch emits its own)
    if (step.type !== "branch") {
      emit("STEP_COMPLETED", "ok", { stepId: step.id });
      ts += 150;
    }

    // Checkpoint
    if (step.checkpointEnabled) {
      const ckpt: RunCheckpoint = {
        id: `ckpt-${step.id}-${sequence}`,
        runId: run.id,
        workflowId: workflow.id,
        workflowVersion: workflow.currentVersion,
        stepId: step.id,
        agentId: step.agentId,
        sequence,
        state: { stepId: step.id, completedAt: new Date(ts).toISOString() },
        input: {},
        outputSoFar: {},
        createdAt: new Date(ts).toISOString(),
      };
      checkpoints.push(ckpt);
      emit("CHECKPOINT_CREATED", "ok", {
        stepId: step.id,
        metadata: { checkpointId: ckpt.id },
      });
      ts += 80;
    }
  }

  // ── Run succeeded ────────────────────────────────────────────────────────────
  completedAt = new Date(ts).toISOString();
  runStatus = "succeeded";
  currentStepId = undefined;
  emit("RUN_SUCCEEDED", "ok");

  return buildResult();

  // ── Step executor ────────────────────────────────────────────────────────────
  function executeStep(step: WorkflowStep): "ok" | "failed" | "pause_approval" {
    switch (step.type) {
      case "agent": {
        const agent = step.agentId ? agents.find((a) => a.id === step.agentId) : null;
        const maxAttempts = step.retryPolicy?.maxAttempts ?? 1;
        const modelName = agent?.modelName ?? "gpt-4.1-mini";

        // 30% failure on first attempt if retries are configured
        const willFail = maxAttempts > 1 && Math.random() < 0.30;

        for (let attempt = 1; attempt <= (willFail ? maxAttempts : 1); attempt++) {
          if (attempt > 1) {
            emit("RETRY_SCHEDULED", "ok", {
              stepId: step.id,
              title: `Retry scheduled (attempt ${attempt}/${maxAttempts})`,
            });
            ts += jitter(300, 800);
            emit("RETRY_STARTED", "ok", {
              stepId: step.id,
              title: `Retry attempt ${attempt}`,
            });
            ts += 150;
          }

          emit("AGENT_STARTED", "ok", {
            stepId: step.id,
            agentId: agent?.id,
            agentName: agent?.name,
            title: `Agent started${agent?.name ? ` — ${agent.name}` : ""}`,
          });
          ts += jitter(300, 600);

          emit("AGENT_PLAN_CREATED", "ok", {
            stepId: step.id,
            agentId: agent?.id,
            agentName: agent?.name,
          });
          ts += jitter(200, 400);

          // LLM call
          const tokens = jitter(400, 1200);
          const cost = +(tokens * 0.000003).toFixed(6);
          totalTokens += tokens;
          totalCost += cost;
          emit("LLM_CALL_STARTED", "ok", {
            stepId: step.id,
            agentId: agent?.id,
            modelName,
            title: `LLM call — ${modelName}`,
          });
          const llmMs = jitter(800, 2200);
          ts += llmMs;
          emit("LLM_CALL_COMPLETED", "ok", {
            stepId: step.id,
            agentId: agent?.id,
            tokens,
            cost,
            durationMs: llmMs,
            modelName,
            title: `LLM call completed (${tokens.toLocaleString()} tokens)`,
          });
          ts += 200;

          // Tool calls
          const toolIds = agent?.allowedToolIds ?? [];
          for (const toolId of toolIds.slice(0, 2)) {
            const tool = tools.find((t) => t.id === toolId);
            emit("TOOL_CALL_STARTED", "ok", {
              stepId: step.id,
              agentId: agent?.id,
              toolId: tool?.id,
              toolName: tool?.name,
              title: `Tool call — ${tool?.name ?? "unknown"}`,
            });
            const toolMs = jitter(200, 800);
            ts += toolMs;
            emit("TOOL_CALL_COMPLETED", "ok", {
              stepId: step.id,
              agentId: agent?.id,
              toolId: tool?.id,
              toolName: tool?.name,
              durationMs: toolMs,
              title: `Tool completed — ${tool?.name ?? "unknown"}`,
            });
            ts += 100;
          }

          // Simulate failure on all-but-last attempt when willFail
          if (willFail && attempt < maxAttempts) {
            const errMsg = "Transient error: upstream service temporarily unavailable";
            emit("AGENT_FAILED", "error", {
              stepId: step.id,
              agentId: agent?.id,
              agentName: agent?.name,
              error: errMsg,
              title: `Agent failed${agent?.name ? ` — ${agent.name}` : ""}`,
            });
            emit("STEP_FAILED", "error", {
              stepId: step.id,
              error: errMsg,
            });
            ts += jitter(200, 400);
            continue; // retry
          }

          // Success
          if (willFail && attempt === maxAttempts) {
            // Exhausted retries → run fails
            emit("RETRY_EXHAUSTED", "error", { stepId: step.id });
            runStatus = "failed";
            completedAt = new Date(ts).toISOString();
            return "failed";
          }

          emit("AGENT_COMPLETED", "ok", {
            stepId: step.id,
            agentId: agent?.id,
            agentName: agent?.name,
            title: `Agent completed${agent?.name ? ` — ${agent.name}` : ""}`,
          });
          ts += 200;
          return "ok";
        }

        // Unreachable normally, but TS needs a return
        return "ok";
      }

      case "tool": {
        const tool = step.toolId ? tools.find((t) => t.id === step.toolId) : null;
        emit("TOOL_CALL_STARTED", "ok", {
          stepId: step.id,
          toolId: tool?.id,
          toolName: tool?.name,
          title: `Tool call — ${tool?.name ?? "unknown"}`,
        });
        const toolMs = jitter(200, 900);
        ts += toolMs;
        emit("TOOL_CALL_COMPLETED", "ok", {
          stepId: step.id,
          toolId: tool?.id,
          toolName: tool?.name,
          durationMs: toolMs,
          title: `Tool completed — ${tool?.name ?? "unknown"}`,
        });
        ts += 100;
        return "ok";
      }

      case "llm": {
        const tokens = jitter(200, 800);
        const cost = +(tokens * 0.000003).toFixed(6);
        totalTokens += tokens;
        totalCost += cost;
        const modelName = step.llmConfig?.model ?? "gpt-4.1-mini";
        emit("LLM_CALL_STARTED", "ok", {
          stepId: step.id,
          modelName,
          title: `LLM call — ${modelName}`,
        });
        const llmMs = jitter(600, 1800);
        ts += llmMs;
        emit("LLM_CALL_COMPLETED", "ok", {
          stepId: step.id,
          tokens,
          cost,
          durationMs: llmMs,
          modelName,
          title: `LLM call completed (${tokens.toLocaleString()} tokens)`,
        });
        if (step.llmConfig?.validationEnabled) {
          ts += 200;
          emit("LLM_OUTPUT_VALIDATED", "ok", { stepId: step.id });
        }
        ts += 100;
        return "ok";
      }

      case "approval": {
        const cfg = step.approvalConfig;
        const gateId = `gate-${run.id}-${step.id}`;
        const gate: ApprovalGate = {
          id: gateId,
          runId: run.id,
          stepId: step.id,
          stepName: step.name,
          workflowId: workflow.id,
          workflowName: workflow.name,
          requestedAt: new Date(ts).toISOString(),
          expiresAt: cfg?.timeoutMs
            ? new Date(ts + cfg.timeoutMs).toISOString()
            : undefined,
          status: "pending",
          requestedBy: "workflow-runtime",
          context: cfg
            ? {
                title: cfg.title,
                message: cfg.message,
                riskLevel: cfg.riskLevel,
                approverRole: cfg.approverRole,
              }
            : undefined,
        };
        approvalGates.push(gate);
        emit("APPROVAL_REQUESTED", "pending", {
          stepId: step.id,
          metadata: { gateId },
        });
        runStatus = "waiting_for_approval";
        return "pause_approval";
      }

      case "branch": {
        emit("STEP_COMPLETED", "ok", {
          stepId: step.id,
          metadata: {
            branchTaken: "true",
            condition: step.branchConfig?.conditionExpression ?? "(condition)",
          },
        });
        ts += 100;
        return "ok";
      }

      case "sleep": {
        const delay = step.timerConfig?.delayMs ?? 1000;
        ts += Math.min(delay, 300);
        return "ok";
      }

      default:
        return "ok";
    }
  }

  // ── Build result ─────────────────────────────────────────────────────────────
  function buildResult(): SimulationResult {
    const durationMs = runStatus === "succeeded" ? ts - startMs : null;

    const updatedRun: AgentRun = {
      ...run,
      status: runStatus,
      currentStepId,
      startedAt: events.find((e) => e.type === "RUN_STARTED")?.timestamp ?? run.startedAt,
      completedAt,
      durationMs,
      totalTokens: totalTokens > 0 ? totalTokens : null,
      estimatedCostUsd: totalCost > 0 ? +totalCost.toFixed(6) : null,
      checkpoints,
      approvalGates,
      replayAvailable: checkpoints.length > 0,
      updatedAt: new Date(ts).toISOString(),
    };

    return { updatedRun, events, pausedAtStepIndex };
  }
}

// ─── Convenience wrapper (fresh run) ─────────────────────────────────────────

export function simulateWorkflow(
  workflow: Workflow,
  run: AgentRun,
  agents: Agent[],
  tools: Tool[],
): Omit<SimulationResult, "pausedAtStepIndex"> {
  return runWorkflowFromStep(workflow, run, agents, tools, [], 0);
}
