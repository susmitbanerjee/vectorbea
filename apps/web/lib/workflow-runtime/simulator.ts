/**
 * Vectorbee Workflow Runtime Simulator
 *
 * Takes a saved workflow definition and a queued AgentRun, then generates a
 * realistic, persisted set of RunEvents + an updated AgentRun.
 *
 * This is the structured "native runtime" for demo / dev mode.
 * Replace this with real worker dispatch when connecting a backend.
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

// ─── Simulator ────────────────────────────────────────────────────────────────

export interface SimulationResult {
  updatedRun: AgentRun;
  events: RunEvent[];
}

function jitter(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

export function simulateWorkflow(
  workflow: Workflow,
  run: AgentRun,
  agents: Agent[],
  tools: Tool[],
): SimulationResult {
  const events: RunEvent[] = [];
  let sequence = 0;
  const startMs = new Date(run.createdAt).getTime();
  let ts = startMs;
  let totalTokens = 0;
  let totalCost = 0;
  const checkpoints: RunCheckpoint[] = [];
  const approvalGates: ApprovalGate[] = [];
  let runStatus: AgentRun["status"] = "succeeded";
  let completedAt: string | null = null;

  // ── Event factory ──────────────────────────────────────────────────────────
  function emit(
    type: RunEventType,
    status: RunEvent["status"],
    extra: Partial<RunEvent> = {},
  ): RunEvent {
    const e: RunEvent = {
      id: nextEvtId(),
      runId: run.id,
      sequence: sequence++,
      timestamp: new Date(ts).toISOString(),
      type,
      status,
      source: "native",
      ...extra,
    };
    events.push(e);
    ts += jitter(40, 120);
    return e;
  }

  // ── Run lifecycle events ───────────────────────────────────────────────────
  emit("RUN_CREATED", "ok");
  ts += 100;
  emit("RUN_QUEUED", "ok");
  ts += 200;
  emit("RUN_STARTED", "ok");
  ts += 300;

  // ── Execute steps ─────────────────────────────────────────────────────────
  const steps = workflow.steps.filter((s) => s.type !== "end");

  for (const step of steps) {
    emit("STEP_SCHEDULED", "ok", { stepId: step.id });
    ts += 80;
    emit("STEP_STARTED", "ok", { stepId: step.id });
    ts += 150;

    const shouldContinue = executeStep(step);
    if (!shouldContinue) {
      // run paused (e.g. approval)
      return buildResult();
    }

    // STEP_COMPLETED (not for branch — it emits its own)
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

  // ── Run succeeded ─────────────────────────────────────────────────────────
  completedAt = new Date(ts).toISOString();
  runStatus = "succeeded";
  emit("RUN_SUCCEEDED", "ok");

  return buildResult();

  // ── Step executor (returns false if run should pause) ─────────────────────
  function executeStep(step: WorkflowStep): boolean {
    switch (step.type) {
      case "agent": {
        const agent = step.agentId ? agents.find((a) => a.id === step.agentId) : null;
        emit("AGENT_STARTED", "ok", {
          stepId: step.id,
          agentId: agent?.id,
          agentName: agent?.name,
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
        const modelName = agent?.modelName ?? "gpt-4.1-mini";
        emit("LLM_CALL_STARTED", "ok", { stepId: step.id, agentId: agent?.id, modelName });
        const llmMs = jitter(800, 2200);
        ts += llmMs;
        emit("LLM_CALL_COMPLETED", "ok", {
          stepId: step.id,
          agentId: agent?.id,
          tokens,
          cost,
          durationMs: llmMs,
          modelName,
        });
        ts += 200;

        // Tool calls if agent has allowed tools
        const toolIds = agent?.allowedToolIds ?? [];
        for (const toolId of toolIds.slice(0, 2)) {
          const tool = tools.find((t) => t.id === toolId);
          emit("TOOL_CALL_STARTED", "ok", {
            stepId: step.id,
            agentId: agent?.id,
            toolId: tool?.id,
            toolName: tool?.name,
          });
          const toolMs = jitter(200, 800);
          ts += toolMs;
          emit("TOOL_CALL_COMPLETED", "ok", {
            stepId: step.id,
            agentId: agent?.id,
            toolId: tool?.id,
            toolName: tool?.name,
            durationMs: toolMs,
          });
          ts += 100;
        }

        emit("AGENT_COMPLETED", "ok", {
          stepId: step.id,
          agentId: agent?.id,
          agentName: agent?.name,
        });
        ts += 200;
        return true;
      }

      case "tool": {
        const tool = step.toolId ? tools.find((t) => t.id === step.toolId) : null;
        emit("TOOL_CALL_STARTED", "ok", {
          stepId: step.id,
          toolId: tool?.id,
          toolName: tool?.name,
        });
        const toolMs = jitter(200, 900);
        ts += toolMs;
        emit("TOOL_CALL_COMPLETED", "ok", {
          stepId: step.id,
          toolId: tool?.id,
          toolName: tool?.name,
          durationMs: toolMs,
        });
        ts += 100;
        return true;
      }

      case "llm": {
        const tokens = jitter(200, 800);
        const cost = +(tokens * 0.000003).toFixed(6);
        totalTokens += tokens;
        totalCost += cost;
        const modelName = step.llmConfig?.model ?? "gpt-4.1-mini";
        emit("LLM_CALL_STARTED", "ok", { stepId: step.id, modelName });
        const llmMs = jitter(600, 1800);
        ts += llmMs;
        emit("LLM_CALL_COMPLETED", "ok", {
          stepId: step.id,
          tokens,
          cost,
          durationMs: llmMs,
          modelName,
        });
        if (step.llmConfig?.validationEnabled) {
          ts += 200;
          emit("LLM_OUTPUT_VALIDATED", "ok", { stepId: step.id });
        }
        ts += 100;
        return true;
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
        return false; // pause run
      }

      case "branch": {
        // Simulate taking the "true" path deterministically
        emit("STEP_COMPLETED", "ok", {
          stepId: step.id,
          metadata: {
            branchTaken: "true",
            condition: step.branchConfig?.conditionExpression ?? "(condition)",
          },
        });
        ts += 100;
        return true;
      }

      case "sleep": {
        // Simulate the timer but don't block
        const delay = step.timerConfig?.delayMs ?? 1000;
        ts += Math.min(delay, 300); // cap simulated delay
        return true;
      }

      default:
        return true;
    }
  }

  // ── Build final result ─────────────────────────────────────────────────────
  function buildResult(): SimulationResult {
    const durationMs =
      runStatus === "succeeded" ? ts - startMs : null;

    const updatedRun: AgentRun = {
      ...run,
      status: runStatus,
      startedAt:
        events.find((e) => e.type === "RUN_STARTED")?.timestamp ?? null,
      completedAt,
      durationMs,
      totalTokens: totalTokens > 0 ? totalTokens : null,
      estimatedCostUsd: totalCost > 0 ? +totalCost.toFixed(6) : null,
      checkpoints,
      approvalGates,
      replayAvailable: checkpoints.length > 0,
      updatedAt: new Date(ts).toISOString(),
    };

    return { updatedRun, events };
  }
}
