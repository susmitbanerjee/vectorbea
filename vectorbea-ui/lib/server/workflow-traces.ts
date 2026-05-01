import "server-only";

import type { WorkflowTrace, WorkflowStepTrace, WorkflowStepType } from "@/lib/api";
import { redactPayload } from "@/lib/server/security";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ─── Row types ────────────────────────────────────────────────────────────────

type TraceRow = {
  id: string;
  workspace_id: string;
  capability_id: string | null;
  capability_version_id: string | null;
  prompt_id: string | null;
  prompt_version_id: string | null;
  agent_run_id: string | null;
  trace_id: string | null;
  provider: string | null;
  model: string | null;
  user_input: string | null;
  final_response: string | null;
  final_action: string | null;
  status: string;
  outcome_status: string | null;
  outcome_reason: string | null;
  final_business_outcome: string | null;
  total_latency_ms: number | null;
  total_cost_estimate: number | null;
  model_cost: number | null;
  tool_cost: number | null;
  judge_cost: number | null;
  retry_cost: number | null;
  total_tokens_input: number | null;
  total_tokens_output: number | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type StepRow = {
  id: string;
  workspace_id: string;
  workflow_trace_id: string;
  step_index: number;
  step_type: string;
  step_name: string;
  provider: string | null;
  model: string | null;
  tool_name: string | null;
  mcp_server_name: string | null;
  input_payload: Record<string, unknown> | null;
  output_payload: Record<string, unknown> | null;
  tool_arguments: Record<string, unknown> | null;
  tool_result: Record<string, unknown> | null;
  status: string;
  latency_ms: number | null;
  cost_estimate: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  error_message: string | null;
  created_at: string;
};

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapTrace(row: TraceRow, steps?: WorkflowStepTrace[]): WorkflowTrace {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    capabilityId: row.capability_id,
    capabilityVersionId: row.capability_version_id,
    promptId: row.prompt_id,
    promptVersionId: row.prompt_version_id,
    agentRunId: row.agent_run_id,
    traceId: row.trace_id,
    provider: row.provider,
    model: row.model,
    userInput: row.user_input,
    finalResponse: row.final_response,
    finalAction: row.final_action,
    status: row.status as WorkflowTrace["status"],
    outcomeStatus: row.outcome_status as WorkflowTrace["outcomeStatus"],
    outcomeReason: row.outcome_reason,
    finalBusinessOutcome: row.final_business_outcome,
    totalLatencyMs: row.total_latency_ms,
    totalCostEstimate: row.total_cost_estimate,
    modelCost: row.model_cost,
    toolCost: row.tool_cost,
    judgeCost: row.judge_cost,
    retryCost: row.retry_cost,
    totalTokensInput: row.total_tokens_input,
    totalTokensOutput: row.total_tokens_output,
    errorMessage: row.error_message,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    steps,
  };
}

function mapStep(row: StepRow): WorkflowStepTrace {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    workflowTraceId: row.workflow_trace_id,
    stepIndex: row.step_index,
    stepType: row.step_type as WorkflowStepType,
    stepName: row.step_name,
    provider: row.provider,
    model: row.model,
    toolName: row.tool_name,
    mcpServerName: row.mcp_server_name,
    inputPayload: row.input_payload ?? {},
    outputPayload: row.output_payload ?? {},
    toolArguments: row.tool_arguments ?? {},
    toolResult: row.tool_result ?? {},
    status: row.status as WorkflowStepTrace["status"],
    latencyMs: row.latency_ms,
    costEstimate: row.cost_estimate,
    tokensInput: row.tokens_input,
    tokensOutput: row.tokens_output,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

// ─── List / Get ───────────────────────────────────────────────────────────────

export async function listWorkflowTraces(
  workspaceId: string,
  opts?: { capabilityId?: string; limit?: number },
): Promise<WorkflowTrace[]> {
  const supabase = createVectorBeaAdminClient();
  let q = supabase
    .from("workflow_traces")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (opts?.capabilityId) q = q.eq("capability_id", opts.capabilityId);
  const { data, error } = await q;
  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapTrace(row as TraceRow));
}

export async function getWorkflowTrace(
  workspaceId: string,
  traceId: string,
): Promise<WorkflowTrace | null> {
  const supabase = createVectorBeaAdminClient();
  const [traceRes, stepsRes] = await Promise.all([
    supabase.from("workflow_traces").select("*").eq("workspace_id", workspaceId).eq("id", traceId).maybeSingle(),
    supabase.from("workflow_step_traces").select("*").eq("workspace_id", workspaceId).eq("workflow_trace_id", traceId).order("step_index", { ascending: true }),
  ]);
  if (traceRes.error) throw new Error(traceRes.error.message);
  if (!traceRes.data) return null;
  const steps = (stepsRes.data ?? []).map((row) => mapStep(row as StepRow));
  return mapTrace(traceRes.data as TraceRow, steps);
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createWorkflowTrace(args: {
  workspaceId: string;
  capabilityId?: string | null;
  capabilityVersionId?: string | null;
  promptId?: string | null;
  promptVersionId?: string | null;
  agentRunId?: string | null;
  traceId?: string | null;
  provider?: string | null;
  model?: string | null;
  userInput?: string | null;
  finalResponse?: string | null;
  finalAction?: string | null;
  status?: WorkflowTrace["status"];
  outcomeStatus?: WorkflowTrace["outcomeStatus"];
  outcomeReason?: string | null;
  finalBusinessOutcome?: string | null;
  totalLatencyMs?: number | null;
  totalCostEstimate?: number | null;
  modelCost?: number | null;
  toolCost?: number | null;
  judgeCost?: number | null;
  retryCost?: number | null;
  totalTokensInput?: number | null;
  totalTokensOutput?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
  steps?: Array<{
    stepIndex: number;
    stepType: WorkflowStepType;
    stepName: string;
    provider?: string | null;
    model?: string | null;
    toolName?: string | null;
    mcpServerName?: string | null;
    inputPayload?: Record<string, unknown>;
    outputPayload?: Record<string, unknown>;
    toolArguments?: Record<string, unknown>;
    toolResult?: Record<string, unknown>;
    status?: WorkflowStepTrace["status"];
    latencyMs?: number | null;
    costEstimate?: number | null;
    tokensInput?: number | null;
    tokensOutput?: number | null;
    errorMessage?: string | null;
  }>;
}): Promise<WorkflowTrace> {
  const supabase = createVectorBeaAdminClient();

  const { data: traceData, error: traceError } = await supabase
    .from("workflow_traces")
    .insert({
      workspace_id: args.workspaceId,
      capability_id: args.capabilityId ?? null,
      capability_version_id: args.capabilityVersionId ?? null,
      prompt_id: args.promptId ?? null,
      prompt_version_id: args.promptVersionId ?? null,
      agent_run_id: args.agentRunId ?? null,
      trace_id: args.traceId ?? null,
      provider: args.provider ?? null,
      model: args.model ?? null,
      user_input: args.userInput ?? null,
      final_response: args.finalResponse ?? null,
      final_action: args.finalAction ?? null,
      status: args.status ?? "completed",
      outcome_status: args.outcomeStatus ?? null,
      outcome_reason: args.outcomeReason ?? null,
      final_business_outcome: args.finalBusinessOutcome ?? null,
      total_latency_ms: args.totalLatencyMs ?? null,
      total_cost_estimate: args.totalCostEstimate ?? null,
      model_cost: args.modelCost ?? null,
      tool_cost: args.toolCost ?? null,
      judge_cost: args.judgeCost ?? null,
      retry_cost: args.retryCost ?? null,
      total_tokens_input: args.totalTokensInput ?? null,
      total_tokens_output: args.totalTokensOutput ?? null,
      error_message: args.errorMessage ?? null,
      metadata: args.metadata ?? {},
    })
    .select("*")
    .single();
  if (traceError) throw new Error(traceError.message);
  const trace = traceData as TraceRow;

  let builtSteps: WorkflowStepTrace[] = [];
  if (args.steps && args.steps.length > 0) {
    const stepInserts = args.steps.map((s) => ({
      workspace_id: args.workspaceId,
      workflow_trace_id: trace.id,
      step_index: s.stepIndex,
      step_type: s.stepType,
      step_name: s.stepName,
      provider: s.provider ?? null,
      model: s.model ?? null,
      tool_name: s.toolName ?? null,
      mcp_server_name: s.mcpServerName ?? null,
      input_payload: redactPayload(s.inputPayload ?? {}),
      output_payload: redactPayload(s.outputPayload ?? {}),
      tool_arguments: redactPayload(s.toolArguments ?? {}),
      tool_result: redactPayload(s.toolResult ?? {}),
      status: s.status ?? "completed",
      latency_ms: s.latencyMs ?? null,
      cost_estimate: s.costEstimate ?? null,
      tokens_input: s.tokensInput ?? null,
      tokens_output: s.tokensOutput ?? null,
      error_message: s.errorMessage ?? null,
    }));
    const { data: stepsData, error: stepsError } = await supabase
      .from("workflow_step_traces")
      .insert(stepInserts)
      .select("*");
    if (stepsError) throw new Error(stepsError.message);
    builtSteps = (stepsData ?? []).map((row) => mapStep(row as StepRow));
  }

  return mapTrace(trace, builtSteps);
}
