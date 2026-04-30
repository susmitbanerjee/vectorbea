import "server-only";

import { randomUUID } from "crypto";

import type {
  BehavioralEvaluationCaseResult,
  BehavioralEvaluationRunView,
  BehavioralJudgeHardFailure,
  BehavioralJudgeResult,
  BehavioralExecutionStep,
  EvaluationRubric,
  ProviderArenaCandidateInput,
} from "@/lib/api";
import { executeResolvedPrompt } from "@/lib/server/execution";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { listBehavioralItems, getBehavioralDataset } from "@/lib/server/behavioral-datasets";
import { getRubricWithDetails } from "@/lib/server/rubrics";
import { getProviderConfig, listEnabledProviders } from "@/lib/server/provider-keys";
import {
  buildReviewQueueForRun,
  getPairwiseForRun,
  getReviewQueueSummary,
  runPairwiseComparisons,
} from "@/lib/server/provider-arena-governance";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

type PromptVersionRow = {
  id: string;
  prompt_id: string;
  version_tag: string;
  template_text: string;
  prompts: { id?: string; name?: string } | Array<{ id?: string; name?: string }> | null;
};

type EvaluationRunRow = {
  id: string;
  workspace_id: string;
  dataset_id: string;
  rubric_id: string;
  prompt_id: string;
  prompt_version_id: string;
  run_type: string;
  status: string;
  provider: string;
  model: string;
  started_by: string;
  started_at: string | null;
  completed_at: string | null;
  summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type EvaluationExecutionRow = {
  id: string;
  evaluation_run_id: string;
  dataset_item_id: string;
  provider_candidate_id: string | null;
  status: string;
  input: string;
  context: string | null;
  output: string | null;
  provider: string;
  model: string;
  prompt_version_id: string;
  latency_ms: number | null;
  cost_estimate: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type ProviderCandidateRow = {
  id: string;
  evaluation_run_id: string;
  provider: string;
  model: string;
  label: string;
  temperature: number | null;
  max_tokens: number | null;
  config: Record<string, unknown> | null;
  created_at: string;
};

type PairwiseRow = {
  id: string;
  evaluation_run_id: string;
  dataset_item_id: string;
  candidate_a_execution_id: string;
  candidate_b_execution_id: string;
  winner_execution_id: string | null;
  result: "a_wins" | "b_wins" | "tie" | "both_bad" | "needs_review";
  confidence: number | null;
  reasoning: string | null;
  dimension_preferences: Record<string, unknown> | null;
  blind_order: Record<string, unknown> | null;
  risk_flags: unknown[] | null;
  needs_review_reason: string | null;
  created_at: string;
};

type ArenaReportRow = {
  id: string;
  evaluation_run_id: string;
  recommended_candidate_id: string | null;
  rollout_recommendation: "safe_to_rollout" | "rollout_with_caution" | "needs_review" | "do_not_rollout";
  decision_score: number | null;
  risk_score: number | null;
  summary: string | null;
  provider_rankings: unknown[] | null;
  dimension_summary: Record<string, unknown> | null;
  failure_clusters: unknown[] | null;
  cost_summary: Record<string, unknown> | null;
  latency_summary: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type JudgeExecutionRow = {
  id: string;
  evaluation_run_id: string;
  evaluation_execution_id: string;
  rubric_id: string;
  judge_provider: string | null;
  judge_model: string | null;
  status: string;
  overall_score: number | null;
  pass: boolean | null;
  confidence: number | null;
  dimension_scores: Record<string, unknown> | null;
  hard_failures: unknown[] | null;
  strengths: unknown[] | null;
  weaknesses: unknown[] | null;
  risk_flags: unknown[] | null;
  verdict_reason: string | null;
  raw_judge_output: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type StepMap = Record<string, BehavioralExecutionStep[]>;

function nowIso() {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getPromptName(prompts: PromptVersionRow["prompts"]) {
  const row = Array.isArray(prompts) ? prompts[0] ?? null : prompts;
  return row?.name ?? "Prompt";
}

function renderTemplate(template: string, variables: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  });
}

function startStep(
  steps: BehavioralExecutionStep[],
  name: string,
  label: string,
  details?: Record<string, unknown>,
): number {
  steps.push({
    name,
    label,
    status: "running",
    startedAt: nowIso(),
    completedAt: null,
    durationMs: null,
    summary: "",
    details: details ?? null,
  });
  return steps.length - 1;
}

function finishStep(
  steps: BehavioralExecutionStep[],
  index: number,
  status: BehavioralExecutionStep["status"],
  summary: string,
  details?: Record<string, unknown>,
) {
  const step = steps[index];
  if (!step) return;
  const completedAt = nowIso();
  const startMs = step.startedAt ? Date.parse(step.startedAt) : Date.now();
  const endMs = Date.parse(completedAt);
  step.status = status;
  step.completedAt = completedAt;
  step.durationMs = Number.isFinite(startMs) ? Math.max(0, endMs - startMs) : null;
  step.summary = summary;
  if (details) step.details = { ...(step.details ?? {}), ...details };
}

function markSkippedSteps(steps: BehavioralExecutionStep[], names: Array<{ name: string; label: string; summary: string }>) {
  const stamp = nowIso();
  for (const step of names) {
    steps.push({
      name: step.name,
      label: step.label,
      status: "skipped",
      startedAt: stamp,
      completedAt: stamp,
      durationMs: 0,
      summary: step.summary,
      details: null,
    });
  }
}

function buildJudgePrompt(rubric: EvaluationRubric, input: string, context: string | null, output: string): string {
  const dimensions = (rubric.dimensions ?? []).map((dimension) => ({
    name: dimension.name,
    description: dimension.description ?? "",
    weight: dimension.weight,
    scale_min: dimension.scaleMin,
    scale_max: dimension.scaleMax,
    pass_threshold: dimension.passThreshold,
  }));
  const rules = rubric.rules ?? [];
  const mustDo = rules.filter((rule) => rule.ruleType === "must_do").map((rule) => `${rule.description} (${rule.severity})`);
  const mustNotDo = rules.filter((rule) => rule.ruleType === "must_not_do").map((rule) => `${rule.description} (${rule.severity})`);
  const hardFail = rules.filter((rule) => rule.ruleType === "hard_fail").map((rule) => `${rule.description} (${rule.severity})`);

  return [
    "You are an enterprise LLM behavior judge",
    "Evaluate only the model output against the provided rubric and context",
    "Do not reward verbosity by default",
    "Do not assume facts that are not present in the context",
    "Return valid JSON only with the exact requested schema",
    "",
    "Rubric",
    `Goal: ${rubric.goal ?? "N/A"}`,
    `Prompt type: ${rubric.promptType}`,
    `Pass threshold: ${rubric.passThreshold}`,
    `Dimensions JSON: ${JSON.stringify(dimensions)}`,
    `Must do rules JSON: ${JSON.stringify(mustDo)}`,
    `Must not do rules JSON: ${JSON.stringify(mustNotDo)}`,
    `Hard fail rules JSON: ${JSON.stringify(hardFail)}`,
    "",
    "Evaluation Input",
    `User input: ${input}`,
    `Context: ${context ?? ""}`,
    `Model output: ${output}`,
    "",
    "Required JSON schema",
    JSON.stringify({
      overall_score: 0,
      pass: true,
      confidence: 0,
      dimension_scores: { dimension_name: 0 },
      hard_failures: [{ rule: "string", severity: "string", reason: "string" }],
      strengths: ["string"],
      weaknesses: ["string"],
      risk_flags: ["string"],
      verdict_reason: "string",
    }),
  ].join("\n");
}

function parseJudgeJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return asRecord(JSON.parse(fenced[1]));
    }
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return asRecord(JSON.parse(trimmed.slice(first, last + 1)));
    }
    throw new Error("Judge returned invalid JSON");
  }
}

function computeWeightedScore(rubric: EvaluationRubric, dimensionScores: Record<string, number>) {
  const dims = rubric.dimensions ?? [];
  const totalWeight = dims.reduce((sum, dimension) => sum + Math.max(0, dimension.weight), 0);
  if (dims.length === 0 || totalWeight <= 0) return null;
  let weighted = 0;
  for (const dimension of dims) {
    const score = clamp(dimensionScores[dimension.name] ?? 0, 0, 100);
    weighted += score * Math.max(0, dimension.weight);
  }
  return clamp(weighted / totalWeight, 0, 100);
}

function computeConfidence(args: {
  judgeConfidence: number | null;
  hasReference: boolean;
  outputPresent: boolean;
  hardFailures: BehavioralJudgeHardFailure[];
  executionStatus: "completed" | "failed";
}) {
  const reasons: string[] = [];
  let score = args.judgeConfidence ?? 0.55;
  if (!args.hasReference) {
    score -= 0.12;
    reasons.push("No expected or reference output was available");
  }
  if (!args.outputPresent) {
    score -= 0.35;
    reasons.push("Model output was empty");
  }
  if (args.executionStatus === "failed") {
    score -= 0.45;
    reasons.push("Provider execution failed");
  }
  if (args.hardFailures.length > 0) {
    score -= 0.1;
    reasons.push("Hard failure rules were triggered");
  }
  const final = clamp(score, 0, 1);
  const label: BehavioralJudgeResult["confidenceLabel"] =
    final >= 0.78 ? "high" : final >= 0.6 ? "medium" : final >= 0.45 ? "low" : "insufficient";
  return { score: final, label, reasons };
}

async function loadPromptVersion(promptVersionId: string) {
  const normalizedId = promptVersionId.trim();
  if (!normalizedId || normalizedId === "undefined" || normalizedId === "null") {
    throw new Error("Prompt version not found: invalid promptVersionId");
  }
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("prompt_versions")
    .select("id,prompt_id,version_tag,template_text,prompts(id,name)")
    .eq("id", normalizedId)
    .single();
  if (error || !data) {
    throw new Error(`Prompt version not found for id '${normalizedId}'`);
  }
  return data as PromptVersionRow;
}

async function insertRun(args: {
  workspaceId: string;
  datasetId: string;
  rubricId: string;
  promptId: string;
  promptVersionId: string;
  provider: string;
  model: string;
  startedBy: string;
  runName?: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("evaluation_runs")
    .insert({
      workspace_id: args.workspaceId,
      dataset_id: args.datasetId,
      rubric_id: args.rubricId,
      prompt_id: args.promptId,
      prompt_version_id: args.promptVersionId,
      run_type: "behavioral_rubric",
      status: "queued",
      provider: args.provider,
      model: args.model,
      started_by: args.startedBy,
      summary: { run_name: args.runName ?? null },
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create evaluation run");
  return data as EvaluationRunRow;
}

async function updateRun(runId: string, patch: Record<string, unknown>) {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase.from("evaluation_runs").update(patch).eq("id", runId);
  if (error) throw new Error(error.message);
}

async function listRunRows(workspaceId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("evaluation_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("run_type", "behavioral_rubric")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as EvaluationRunRow[];
}

async function getRunRow(workspaceId: string, runId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("evaluation_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as EvaluationRunRow | null) ?? null;
}

async function getRunExecutions(runId: string) {
  const supabase = createVectorBeaAdminClient();
  const [execRes, judgeRes] = await Promise.all([
    supabase.from("evaluation_executions").select("*").eq("evaluation_run_id", runId).order("created_at", { ascending: true }),
    supabase.from("judge_executions").select("*").eq("evaluation_run_id", runId).order("created_at", { ascending: true }),
  ]);
  if (execRes.error) throw new Error(execRes.error.message);
  if (judgeRes.error) throw new Error(judgeRes.error.message);
  return {
    executions: (execRes.data ?? []) as EvaluationExecutionRow[],
    judges: (judgeRes.data ?? []) as JudgeExecutionRow[],
  };
}

function mapJudge(row: JudgeExecutionRow): BehavioralJudgeResult | null {
  if (row.status !== "completed") return null;
  const hardFailuresRaw = asArray(row.hard_failures);
  const hardFailures = hardFailuresRaw.map((entry) => {
    const rec = asRecord(entry);
    return {
      rule: String(rec.rule ?? ""),
      severity: String(rec.severity ?? "medium"),
      reason: String(rec.reason ?? ""),
    };
  }).filter((item) => item.rule.length > 0) as BehavioralJudgeHardFailure[];
  const confidence = clamp(asNumber(row.confidence) ?? 0, 0, 1);
  const confidenceLabel: BehavioralJudgeResult["confidenceLabel"] =
    confidence >= 0.78 ? "high" : confidence >= 0.6 ? "medium" : confidence >= 0.45 ? "low" : "insufficient";
  return {
    overallScore: clamp(asNumber(row.overall_score) ?? 0, 0, 100),
    judgeOverallScore: clamp(asNumber(asRecord(row.raw_judge_output).overall_score) ?? NaN, 0, 100) || null,
    computedScore: clamp(asNumber(asRecord(row.raw_judge_output).computed_score) ?? asNumber(row.overall_score) ?? 0, 0, 100),
    pass: Boolean(row.pass),
    confidence,
    confidenceLabel,
    confidenceReasons: asArray(asRecord(row.raw_judge_output).confidence_reasons).map((item) => String(item)),
    dimensionScores: Object.fromEntries(
      Object.entries(asRecord(row.dimension_scores)).map(([key, value]) => [key, clamp(asNumber(value) ?? 0, 0, 100)]),
    ),
    hardFailures,
    strengths: asArray(row.strengths).map((item) => String(item)),
    weaknesses: asArray(row.weaknesses).map((item) => String(item)),
    riskFlags: asArray(row.risk_flags).map((item) => String(item)),
    verdictReason: row.verdict_reason ?? "",
    needsReview: confidence < 0.6,
    rawJudgeOutput: row.raw_judge_output,
  };
}

async function getDatasetItemsWithExpected(datasetId: string) {
  const items = await listBehavioralItems(datasetId);
  return items.map((item) => ({
    ...item,
    expectedOutput: item.referenceOutput,
  }));
}

function buildRunView(args: {
  run: EvaluationRunRow;
  datasetName: string | null;
  rubricName: string | null;
  promptName: string | null;
  promptVersionTag: string | null;
  results: BehavioralEvaluationCaseResult[];
}): BehavioralEvaluationRunView {
  const totals = {
    total: args.results.length,
    completed: args.results.filter((item) => item.status === "completed").length,
    failed: args.results.filter((item) => item.status === "failed").length,
    passCount: args.results.filter((item) => item.judge?.pass).length,
    failCount: args.results.filter((item) => item.judge && !item.judge.pass).length,
    needsReviewCount: args.results.filter((item) => item.judge?.needsReview).length,
    hardFailureCount: args.results.reduce((sum, item) => sum + (item.judge?.hardFailures.length ?? 0), 0),
  };
  const scoreValues = args.results.map((item) => item.judge?.overallScore).filter((score): score is number => typeof score === "number");
  const confValues = args.results.map((item) => item.judge?.confidence).filter((score): score is number => typeof score === "number");
  const averageScore = scoreValues.length > 0 ? scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length : null;
  const averageConfidence = confValues.length > 0 ? confValues.reduce((sum, value) => sum + value, 0) / confValues.length : null;
  const summary = asRecord(args.run.summary);
  const dimensions = asRecord(summary.dimension_averages);
  const finalScore = averageScore;
  const passed = Boolean(summary.passed ?? (finalScore !== null && finalScore >= (asNumber(summary.pass_threshold) ?? 80) && totals.hardFailureCount === 0));

  return {
    id: args.run.id,
    workspaceId: args.run.workspace_id,
    runType: args.run.run_type as BehavioralEvaluationRunView["runType"],
    status: args.run.status as BehavioralEvaluationRunView["status"],
    datasetId: args.run.dataset_id,
    datasetName: args.datasetName,
    rubricId: args.run.rubric_id,
    rubricName: args.rubricName,
    promptId: args.run.prompt_id,
    promptName: args.promptName,
    promptVersionId: args.run.prompt_version_id,
    promptVersionTag: args.promptVersionTag,
    provider: args.run.provider,
    model: args.run.model,
    startedBy: args.run.started_by,
    startedAt: args.run.started_at,
    completedAt: args.run.completed_at,
    createdAt: args.run.created_at,
    updatedAt: args.run.updated_at,
    aggregate: {
      ...totals,
      averageScore: averageScore === null ? null : Number(averageScore.toFixed(2)),
      averageConfidence: averageConfidence === null ? null : Number(averageConfidence.toFixed(3)),
      finalScore: finalScore === null ? null : Number(finalScore.toFixed(2)),
      passed,
      dimensionAverages: Object.fromEntries(
        Object.entries(dimensions).map(([key, value]) => [key, Number((asNumber(value) ?? 0).toFixed(2))]),
      ),
    },
    results: args.results,
  };
}

export async function startBehavioralRubricRun(args: {
  workspaceId: string;
  datasetId: string;
  rubricId: string;
  promptVersionId: string;
  provider: string;
  model: string;
  runName?: string;
  startedBy: string;
}) {
  await assertFeatureAccess(args.workspaceId, "provider_arena");
  const dataset = await getBehavioralDataset(args.workspaceId, args.datasetId);
  if (!dataset) throw new Error("Behavioral dataset not found");
  const rubric = await getRubricWithDetails(args.rubricId);
  if (!rubric || rubric.datasetId !== dataset.id) throw new Error("Rubric not found for selected dataset");
  const version = await loadPromptVersion(args.promptVersionId);
  if (version.prompt_id !== dataset.promptId) throw new Error("Prompt version does not match dataset prompt");
  const provider = await getProviderConfig(args.workspaceId, args.provider);
  if (!provider) throw new Error("Provider not configured");

  const run = await insertRun({
    workspaceId: args.workspaceId,
    datasetId: dataset.id,
    rubricId: rubric.id,
    promptId: version.prompt_id,
    promptVersionId: version.id,
    provider: args.provider,
    model: args.model,
    startedBy: args.startedBy,
    runName: args.runName ?? null,
  });

  try {
    await executeBehavioralRun({
      runId: run.id,
      workspaceId: args.workspaceId,
      datasetId: dataset.id,
      rubric,
      version,
      providerConfig: provider,
      selectedModel: args.model,
    });
  } catch (error) {
    await updateRun(run.id, {
      status: "failed",
      completed_at: nowIso(),
      summary: {
        ...(run.summary ?? {}),
        error: error instanceof Error ? error.message : "Behavioral run failed",
      },
    });
    try {
      const { notifyEvaluationFailed } = await import("@/lib/server/notifications");
      await notifyEvaluationFailed({
        workspaceId: args.workspaceId,
        promptName: getPromptName(version.prompts),
        versionTag: version.version_tag,
        reason: error instanceof Error ? error.message : "Behavioral run failed",
        runId: run.id,
        runType: "behavioral_rubric",
        provider: args.provider,
        model: args.model,
        startedBy: args.startedBy,
      });
    } catch {
      // Notification failures must not fail caller
    }
    throw error;
  }

  const view = await getBehavioralRunDetail(args.workspaceId, run.id);
  if (!view) throw new Error("Failed to load behavioral run after execution");
  return view;
}

async function executeBehavioralRun(args: {
  runId: string;
  workspaceId: string;
  datasetId: string;
  rubric: EvaluationRubric;
  version: PromptVersionRow;
  providerConfig: { config: { provider_type: string; base_url: string | null; id: string; default_model: string | null }; apiKey: string };
  selectedModel: string;
}) {
  const supabase = createVectorBeaAdminClient();
  const startedAt = nowIso();
  await updateRun(args.runId, { status: "running", started_at: startedAt });

  const datasetItems = await getDatasetItemsWithExpected(args.datasetId);
  const stepsByExecution: StepMap = {};
  const results: BehavioralEvaluationCaseResult[] = [];

  for (const item of datasetItems) {
    const executionSteps: BehavioralExecutionStep[] = [];
    const loadIdx = startStep(executionSteps, "load_dataset_item", "Load dataset item", { datasetItemId: item.id });
    finishStep(executionSteps, loadIdx, "success", "Loaded dataset item");

    const variables: Record<string, unknown> = {
      input: item.input,
      user_input: item.input,
      context: item.context ?? "",
      ...(item.metadata ?? {}),
    };
    const renderIdx = startStep(executionSteps, "render_prompt", "Render prompt");
    const renderedPrompt = renderTemplate(args.version.template_text, variables);
    finishStep(executionSteps, renderIdx, "success", "Rendered prompt template");

    const executionInsert = await supabase
      .from("evaluation_executions")
      .insert({
        evaluation_run_id: args.runId,
        dataset_item_id: item.id,
        status: "running",
        input: item.input,
        context: item.context,
        provider: args.providerConfig.config.provider_type,
        model: args.selectedModel,
        prompt_version_id: args.version.id,
      })
      .select("*")
      .single();

    if (executionInsert.error || !executionInsert.data) {
      throw new Error(executionInsert.error?.message ?? "Failed to create execution row");
    }
    const executionRow = executionInsert.data as EvaluationExecutionRow;
    stepsByExecution[executionRow.id] = executionSteps;

    let outputText: string | null = null;
    let execStatus: "completed" | "failed" = "completed";
    let execError: string | null = null;
    let latencyMs: number | null = null;
    let tokensInput: number | null = null;
    let tokensOutput: number | null = null;
    let judgeResult: BehavioralJudgeResult | null = null;

    const callIdx = startStep(executionSteps, "call_provider", "Call provider", {
      provider: args.providerConfig.config.provider_type,
      model: args.selectedModel,
    });
    try {
      const runtime = await executeResolvedPrompt({
        workspaceId: args.workspaceId,
        promptVersionId: args.version.id,
        promptName: getPromptName(args.version.prompts),
        versionTag: args.version.version_tag,
        templateText: args.version.template_text,
        variables,
        inputText: item.input,
        renderedPrompt,
        providerConfig: {
          providerType: args.providerConfig.config.provider_type,
          apiKey: args.providerConfig.apiKey,
          baseUrl: args.providerConfig.config.base_url,
          model: args.selectedModel,
          configId: args.providerConfig.config.id,
        },
        executorOverride: {
          type: "direct_provider",
          provider: args.providerConfig.config.provider_type,
          model: args.selectedModel,
        },
      });
      outputText = runtime.outputText;
      latencyMs = runtime.llmLatencyMs;
      tokensInput = asNumber(runtime.metadata.model?.input_tokens);
      tokensOutput = asNumber(runtime.metadata.model?.output_tokens) ?? asNumber(runtime.metadata.model?.total_tokens);
      finishStep(executionSteps, callIdx, "success", "Provider returned output", { latencyMs, tokenCount: runtime.tokenCount });
    } catch (error) {
      execStatus = "failed";
      execError = error instanceof Error ? error.message : "Provider execution failed";
      finishStep(executionSteps, callIdx, "error", execError);
      markSkippedSteps(executionSteps, [
        { name: "receive_output", label: "Receive output", summary: "Skipped after provider failure" },
        { name: "compare_expected_or_reference", label: "Compare expected or reference", summary: "Skipped after provider failure" },
        { name: "calculate_similarity", label: "Calculate similarity", summary: "Skipped after provider failure" },
        { name: "calculate_confidence", label: "Calculate confidence", summary: "Skipped after provider failure" },
        { name: "calculate_weighted_score", label: "Calculate weighted score", summary: "Skipped after provider failure" },
        { name: "assign_verdict", label: "Assign verdict", summary: "Skipped after provider failure" },
      ]);
    }

    if (execStatus === "completed") {
      const receiveIdx = startStep(executionSteps, "receive_output", "Receive output");
      finishStep(receiveIdx >= 0 ? executionSteps : [], receiveIdx, "success", "Captured model output");

      const compareIdx = startStep(executionSteps, "compare_expected_or_reference", "Compare expected or reference");
      const hasReference = Boolean(item.expectedOutput && item.expectedOutput.trim().length > 0);
      finishStep(
        executionSteps,
        compareIdx,
        hasReference ? "success" : "warning",
        hasReference ? "Using expected output reference" : "No expected output provided, rubric only scoring",
      );

      const judgeInsert = await supabase
        .from("judge_executions")
        .insert({
          evaluation_run_id: args.runId,
          evaluation_execution_id: executionRow.id,
          rubric_id: args.rubric.id,
          judge_provider: args.rubric.judgeProvider ?? args.providerConfig.config.provider_type,
          judge_model: args.rubric.judgeModel ?? args.selectedModel,
          status: "running",
        })
        .select("*")
        .single();

      if (judgeInsert.error || !judgeInsert.data) {
        throw new Error(judgeInsert.error?.message ?? "Failed to create judge execution");
      }
      const judgeRow = judgeInsert.data as JudgeExecutionRow;

      const similarityIdx = startStep(executionSteps, "calculate_similarity", "Calculate similarity");
      const confidenceIdx = startStep(executionSteps, "calculate_confidence", "Calculate confidence");
      const weightedIdx = startStep(executionSteps, "calculate_weighted_score", "Calculate weighted score");
      const verdictIdx = startStep(executionSteps, "assign_verdict", "Assign verdict");

      try {
        const judgePrompt = buildJudgePrompt(args.rubric, item.input, item.context, outputText ?? "");
        const judgeConfigProvider = args.rubric.judgeProvider ?? args.providerConfig.config.provider_type;
        const judgeConfig = await getProviderConfig(args.workspaceId, judgeConfigProvider);
        if (!judgeConfig) throw new Error(`Judge provider '${judgeConfigProvider}' is not configured`);
        const judgeModel = args.rubric.judgeModel ?? judgeConfig.config.default_model ?? args.selectedModel;
        const judgeResponse = await executeResolvedPrompt({
          workspaceId: args.workspaceId,
          promptVersionId: args.version.id,
          promptName: "behavioral-rubric-judge",
          versionTag: "judge-v1",
          templateText: judgePrompt,
          variables: {},
          inputText: "Evaluate and return JSON only",
          renderedPrompt: judgePrompt,
          providerConfig: {
            providerType: judgeConfig.config.provider_type,
            apiKey: judgeConfig.apiKey,
            baseUrl: judgeConfig.config.base_url,
            model: judgeModel,
            configId: judgeConfig.config.id,
          },
          executorOverride: {
            type: "direct_provider",
            provider: judgeConfig.config.provider_type,
            model: judgeModel,
          },
        });
        const parsed = parseJudgeJson(judgeResponse.outputText);
        const judgeOverall = clamp(asNumber(parsed.overall_score) ?? 0, 0, 100);
        const judgeConfidence = clamp(asNumber(parsed.confidence) ?? 0.5, 0, 1);
        const rawDims = asRecord(parsed.dimension_scores);
        const dimensionScores = Object.fromEntries(
          Object.entries(rawDims).map(([key, value]) => [key, clamp(asNumber(value) ?? 0, 0, 100)]),
        ) as Record<string, number>;
        const computed = computeWeightedScore(args.rubric, dimensionScores) ?? judgeOverall;
        const hardFailures = asArray(parsed.hard_failures).map((entry) => {
          const rec = asRecord(entry);
          return {
            rule: String(rec.rule ?? ""),
            severity: String(rec.severity ?? "medium"),
            reason: String(rec.reason ?? ""),
          };
        }).filter((entry) => entry.rule.length > 0) as BehavioralJudgeHardFailure[];
        const hasCriticalHardFail = hardFailures.some((entry) => entry.severity.toLowerCase() === "critical");
        const finalScore = computed;
        const passThreshold = args.rubric.passThreshold ?? 80;
        const finalPass = !hasCriticalHardFail && finalScore >= passThreshold;
        const confidence = computeConfidence({
          judgeConfidence,
          hasReference,
          outputPresent: Boolean(outputText && outputText.trim().length > 0),
          hardFailures,
          executionStatus: execStatus,
        });

        judgeResult = {
          overallScore: finalScore,
          judgeOverallScore: judgeOverall,
          computedScore: computed,
          pass: finalPass,
          confidence: confidence.score,
          confidenceLabel: confidence.label,
          confidenceReasons: confidence.reasons,
          dimensionScores,
          hardFailures,
          strengths: asArray(parsed.strengths).map((entry) => String(entry)),
          weaknesses: asArray(parsed.weaknesses).map((entry) => String(entry)),
          riskFlags: asArray(parsed.risk_flags).map((entry) => String(entry)),
          verdictReason: asString(parsed.verdict_reason) ?? "",
          needsReview: confidence.score < 0.6,
          rawJudgeOutput: parsed,
        };

        finishStep(executionSteps, similarityIdx, hasReference ? "success" : "warning", hasReference ? "Similarity reference available" : "Similarity unavailable without expected output");
        finishStep(executionSteps, confidenceIdx, "success", `Confidence ${Math.round(confidence.score * 100)}%`);
        finishStep(executionSteps, weightedIdx, "success", `Computed weighted score ${Math.round(computed)}`);
        finishStep(executionSteps, verdictIdx, finalPass ? "success" : "warning", finalPass ? "Case passed rubric threshold" : "Case failed rubric threshold");

        await supabase
          .from("judge_executions")
          .update({
            status: "completed",
            overall_score: Number(finalScore.toFixed(2)),
            pass: finalPass,
            confidence: Number(confidence.score.toFixed(4)),
            dimension_scores: dimensionScores,
            hard_failures: hardFailures,
            strengths: judgeResult.strengths,
            weaknesses: judgeResult.weaknesses,
            risk_flags: judgeResult.riskFlags,
            verdict_reason: judgeResult.verdictReason,
            raw_judge_output: {
              ...parsed,
              judge_overall_score: judgeOverall,
              computed_score: computed,
              confidence_reasons: confidence.reasons,
              expected_output: item.expectedOutput ?? null,
              reference_output: item.expectedOutput ?? null,
              rendered_prompt: renderedPrompt,
              execution_steps: executionSteps,
            },
          })
          .eq("id", judgeRow.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Judge execution failed";
        finishStep(executionSteps, similarityIdx, "error", message);
        finishStep(executionSteps, confidenceIdx, "skipped", "Skipped because judge failed");
        finishStep(executionSteps, weightedIdx, "skipped", "Skipped because judge failed");
        finishStep(executionSteps, verdictIdx, "skipped", "Skipped because judge failed");
        await supabase
          .from("judge_executions")
          .update({
            status: "failed",
            raw_judge_output: {
              error: message,
              expected_output: item.expectedOutput ?? null,
              reference_output: item.expectedOutput ?? null,
              rendered_prompt: renderedPrompt,
              execution_steps: executionSteps,
            },
            verdict_reason: message,
          })
          .eq("evaluation_execution_id", executionRow.id);
      }
    }

    await supabase
      .from("evaluation_executions")
      .update({
        status: execStatus,
        output: outputText,
        latency_ms: latencyMs,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        error: execError,
      })
      .eq("id", executionRow.id);

    results.push({
      evaluationExecutionId: executionRow.id,
      datasetItemId: item.id,
      status: execStatus,
      input: item.input,
      context: item.context,
      output: outputText,
      provider: args.providerConfig.config.provider_type,
      model: args.selectedModel,
      promptVersionId: args.version.id,
      latencyMs,
      tokensInput,
      tokensOutput,
      error: execError,
      expectedOutput: item.expectedOutput ?? null,
      referenceOutput: item.expectedOutput ?? null,
      renderedPrompt,
      judge: judgeResult,
      executionSteps,
    });
  }

  const dimensionAverages: Record<string, number> = {};
  const byDimension: Record<string, number[]> = {};
  for (const result of results) {
    for (const [name, value] of Object.entries(result.judge?.dimensionScores ?? {})) {
      byDimension[name] = byDimension[name] ?? [];
      byDimension[name]!.push(value);
    }
  }
  for (const [name, values] of Object.entries(byDimension)) {
    dimensionAverages[name] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  const scoreValues = results.map((result) => result.judge?.overallScore).filter((score): score is number => typeof score === "number");
  const averageScore = scoreValues.length > 0 ? scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length : null;
  const hardFailureCount = results.reduce((sum, result) => sum + (result.judge?.hardFailures.length ?? 0), 0);
  const passThreshold = args.rubric.passThreshold ?? 80;
  const passed = averageScore !== null && averageScore >= passThreshold && hardFailureCount === 0;

  await updateRun(args.runId, {
    status: "completed",
    completed_at: nowIso(),
    summary: {
      total: results.length,
      completed: results.filter((result) => result.status === "completed").length,
      failed: results.filter((result) => result.status === "failed").length,
      pass_count: results.filter((result) => result.judge?.pass).length,
      fail_count: results.filter((result) => result.judge && !result.judge.pass).length,
      needs_review_count: results.filter((result) => result.judge?.needsReview).length,
      average_score: averageScore,
      hard_failure_count: hardFailureCount,
      pass_threshold: passThreshold,
      passed,
      dimension_averages: dimensionAverages,
    },
  });

  try {
    const { notifyEvaluationCompleted } = await import("@/lib/server/notifications");
    await notifyEvaluationCompleted({
      workspaceId: args.workspaceId,
      promptName: getPromptName(args.version.prompts),
      versionTag: args.version.version_tag,
      recommendation: passed ? "ready_for_rollout" : "needs_review",
      score: averageScore,
      runId: args.runId,
      runType: "behavioral_rubric",
      rubricName: args.rubric.name,
      totalCount: results.length,
      failedCount: results.filter((result) => result.status === "failed").length,
      needsReviewCount: results.filter((result) => result.judge?.needsReview).length,
      hardFailureCount: hardFailureCount,
      averageConfidence: null,
      provider: args.providerConfig.config.provider_type,
      model: args.selectedModel,
    });
  } catch {
    // Notification failures must not fail the evaluation run
  }
}

export async function listBehavioralRuns(workspaceId: string): Promise<BehavioralEvaluationRunView[]> {
  await assertFeatureAccess(workspaceId, "behavioral_evaluations");
  const rows = await listRunRows(workspaceId);
  const views = await Promise.all(rows.map((row) => getBehavioralRunDetail(workspaceId, row.id)));
  return views.filter((row): row is BehavioralEvaluationRunView => row !== null);
}

export async function getBehavioralRunDetail(workspaceId: string, runId: string): Promise<BehavioralEvaluationRunView | null> {
  await assertFeatureAccess(workspaceId, "behavioral_evaluations");
  const run = await getRunRow(workspaceId, runId);
  if (!run) return null;

  const [dataset, rubric, version, executionData] = await Promise.all([
    getBehavioralDataset(workspaceId, run.dataset_id),
    getRubricWithDetails(run.rubric_id),
    loadPromptVersion(run.prompt_version_id),
    getRunExecutions(run.id),
  ]);

  const judgeByExecutionId = new Map<string, JudgeExecutionRow>();
  for (const judgeRow of executionData.judges) {
    judgeByExecutionId.set(judgeRow.evaluation_execution_id, judgeRow);
  }

  const results: BehavioralEvaluationCaseResult[] = executionData.executions.map((execution) => {
    const judge = judgeByExecutionId.get(execution.id) ?? null;
    const raw = asRecord(judge?.raw_judge_output);
    const executionSteps = asArray(raw.execution_steps).map((entry) => {
      const step = asRecord(entry);
      return {
        name: String(step.name ?? "step"),
        label: String(step.label ?? "Step"),
        status: (asString(step.status) as BehavioralExecutionStep["status"]) ?? "skipped",
        startedAt: asString(step.started_at ?? step.startedAt),
        completedAt: asString(step.completed_at ?? step.completedAt),
        durationMs: asNumber(step.duration_ms ?? step.durationMs),
        summary: String(step.summary ?? ""),
        details: asRecord(step.details),
      };
    });

    return {
      evaluationExecutionId: execution.id,
      datasetItemId: execution.dataset_item_id,
      status: execution.status === "failed" ? "failed" : "completed",
      input: execution.input,
      context: execution.context,
      output: execution.output,
      provider: execution.provider,
      model: execution.model,
      promptVersionId: execution.prompt_version_id,
      latencyMs: execution.latency_ms,
      tokensInput: execution.tokens_input,
      tokensOutput: execution.tokens_output,
      error: execution.error,
      expectedOutput: asString(raw.expected_output),
      referenceOutput: asString(raw.reference_output),
      renderedPrompt: asString(raw.rendered_prompt),
      judge: judge ? mapJudge(judge) : null,
      executionSteps,
    };
  });

  return buildRunView({
    run,
    datasetName: dataset?.name ?? null,
    rubricName: rubric?.name ?? null,
    promptName: getPromptName(version.prompts),
    promptVersionTag: version.version_tag,
    results,
  });
}

async function insertProviderCandidates(
  runId: string,
  candidates: ProviderArenaCandidateInput[],
): Promise<ProviderCandidateRow[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("provider_candidates")
    .insert(
      candidates.map((candidate) => ({
        evaluation_run_id: runId,
        provider: candidate.provider,
        model: candidate.model,
        label: candidate.label?.trim() || `${candidate.provider} ${candidate.model}`,
        temperature: candidate.temperature ?? null,
        max_tokens: candidate.maxTokens ?? null,
        config: candidate.config ?? {},
      })),
    )
    .select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as ProviderCandidateRow[];
}

function normalizeArenaScores(candidateRows: Array<{
  candidate: ProviderCandidateRow;
  score: number | null;
  passRate: number;
  hardFailRate: number;
  confidence: number | null;
  latencyAvg: number | null;
  latencyP95: number | null;
  costTotal: number | null;
  dimensionAverages: Record<string, number>;
  needsReviewRate: number;
  failedCasesCount: number;
  riskFlagsCount: number;
  pairwiseWinRate: number | null;
  pairwiseLossRate: number | null;
  tieRate: number | null;
  bothBadRate: number | null;
  pairwiseConfidenceAverage: number | null;
}>) {
  const maxLatency = Math.max(...candidateRows.map((row) => row.latencyAvg ?? 0), 1);
  const maxCost = Math.max(...candidateRows.map((row) => row.costTotal ?? 0), 0.000001);
  const enriched = candidateRows.map((row) => {
    const quality = row.score ?? 0;
    const safety = 100 - row.hardFailRate * 100;
    const policy = row.dimensionAverages["Policy compliance"] ?? row.dimensionAverages["policy_compliance"] ?? quality;
    const grounding = row.dimensionAverages["Grounding"] ?? row.dimensionAverages["grounding"] ?? quality;
    const latencyScore = Math.max(0, 100 * (1 - (row.latencyAvg ?? 0) / maxLatency));
    const costScore = Math.max(0, 100 * (1 - (row.costTotal ?? 0) / maxCost));
    const confidenceScore = (row.confidence ?? 0) * 100;
    const pairwiseScore = (row.pairwiseWinRate ?? 0.5) * 100;
    const decisionBase =
      quality * 0.5 +
      pairwiseScore * 0.25 +
      safety * 0.15 +
      policy * 0.15 +
      grounding * 0.1 +
      latencyScore * 0.05 +
      costScore * 0.05 +
      confidenceScore * 0.05;
    const penalties =
      row.hardFailRate * 35 +
      ((row.pairwiseLossRate ?? 0) > 0.5 ? 6 : 0) +
      (row.needsReviewRate > 0.3 ? 8 : 0) +
      ((row.confidence ?? 0) < 0.6 ? 10 : 0);
    const decisionScore = clamp(decisionBase - penalties, 0, 100);
    const riskScore = clamp(
      row.hardFailRate * 55 +
      row.needsReviewRate * 20 +
      (1 - (row.confidence ?? 0.4)) * 15 +
      (row.failedCasesCount > 0 ? 10 : 0),
      0,
      100,
    );
    return { ...row, decisionScore, riskScore };
  });
  return enriched.sort((a, b) => b.decisionScore - a.decisionScore);
}

function arenaRecommendation(best: {
  decisionScore: number;
  riskScore: number;
  passRate: number;
  hardFailRate: number;
  confidence: number | null;
}, second?: { decisionScore: number }): {
  value: "safe_to_rollout" | "rollout_with_caution" | "needs_review" | "do_not_rollout";
  summary: string;
} {
  const closeCompetition = second ? Math.abs(best.decisionScore - second.decisionScore) < 4 : false;
  if (best.hardFailRate > 0.12 || best.passRate < 0.6 || best.riskScore >= 70) {
    return {
      value: "do_not_rollout",
      summary: "No provider is safe to rollout because high risk or failure thresholds were breached",
    };
  }
  if ((best.confidence ?? 0) < 0.6 || closeCompetition || best.riskScore >= 45) {
    return {
      value: "needs_review",
      summary: "Top providers are close or confidence is low so manual review is required",
    };
  }
  if (best.riskScore >= 30 || best.hardFailRate > 0.05) {
    return {
      value: "rollout_with_caution",
      summary: "Best candidate leads but medium risk indicators require cautious rollout",
    };
  }
  return {
    value: "safe_to_rollout",
    summary: "Best candidate shows strong quality with low risk and acceptable confidence",
  };
}

export async function startProviderArenaRun(args: {
  workspaceId: string;
  datasetId: string;
  rubricId: string;
  promptVersionId: string;
  candidates: ProviderArenaCandidateInput[];
  runName?: string;
  startedBy: string;
}) {
  await assertFeatureAccess(args.workspaceId, "behavioral_evaluations");
  const dataset = await getBehavioralDataset(args.workspaceId, args.datasetId);
  if (!dataset) throw new Error("Behavioral dataset not found");
  const rubric = await getRubricWithDetails(args.rubricId);
  if (!rubric || rubric.datasetId !== dataset.id) throw new Error("Rubric not found for selected dataset");
  const version = await loadPromptVersion(args.promptVersionId);
  if (version.prompt_id !== dataset.promptId) throw new Error("Prompt version does not match dataset prompt");
  if (!args.candidates.length) throw new Error("At least one provider candidate is required");

  const enabledProviders = await listEnabledProviders(args.workspaceId);
  const enabledSet = new Set(enabledProviders.map((provider) => provider.provider_type));
  for (const candidate of args.candidates) {
    if (!enabledSet.has(candidate.provider)) {
      throw new Error(`Provider not configured: ${candidate.provider}`);
    }
  }

  const run = await insertRun({
    workspaceId: args.workspaceId,
    datasetId: dataset.id,
    rubricId: rubric.id,
    promptId: version.prompt_id,
    promptVersionId: version.id,
    provider: "arena",
    model: "multi",
    startedBy: args.startedBy,
    runName: args.runName ?? null,
  });
  await updateRun(run.id, { run_type: "provider_arena" });
  const candidateRows = await insertProviderCandidates(run.id, args.candidates);

  const datasetItems = await getDatasetItemsWithExpected(dataset.id);
  const supabase = createVectorBeaAdminClient();
  await updateRun(run.id, { status: "running", started_at: nowIso() });

  const results: BehavioralEvaluationCaseResult[] = [];
  const candidateStats = new Map<string, { scores: number[]; pass: number; hardFails: number; confidence: number[]; latencies: number[]; costs: number[]; needsReview: number; failedCases: number; riskFlags: number; dims: Record<string, number[]> }>();
  for (const candidate of candidateRows) {
    candidateStats.set(candidate.id, { scores: [], pass: 0, hardFails: 0, confidence: [], latencies: [], costs: [], needsReview: 0, failedCases: 0, riskFlags: 0, dims: {} });
  }

  for (const item of datasetItems) {
    for (const candidate of candidateRows) {
      const providerCfg = await getProviderConfig(args.workspaceId, candidate.provider);
      if (!providerCfg) throw new Error(`Provider not configured: ${candidate.provider}`);
      const executionSteps: BehavioralExecutionStep[] = [];
      const variables: Record<string, unknown> = {
        input: item.input,
        user_input: item.input,
        context: item.context ?? "",
        ...(item.metadata ?? {}),
      };
      const renderIdx = startStep(executionSteps, "render_prompt", "Render prompt");
      const renderedPrompt = renderTemplate(version.template_text, variables);
      finishStep(executionSteps, renderIdx, "success", "Rendered prompt template");

      const executionInsert = await supabase
        .from("evaluation_executions")
        .insert({
          evaluation_run_id: run.id,
          dataset_item_id: item.id,
          provider_candidate_id: candidate.id,
          status: "running",
          input: item.input,
          context: item.context,
          provider: candidate.provider,
          model: candidate.model,
          prompt_version_id: version.id,
        })
        .select("*")
        .single();
      if (executionInsert.error || !executionInsert.data) throw new Error(executionInsert.error?.message ?? "Failed to create execution");
      const execution = executionInsert.data as EvaluationExecutionRow;

      let runtimeError: string | null = null;
      let runtimeOutput: string | null = null;
      let latencyMs: number | null = null;
      let tokensInput: number | null = null;
      let tokensOutput: number | null = null;
      let judgeResult: BehavioralJudgeResult | null = null;

      const callIdx = startStep(executionSteps, "call_provider", "Call provider", { provider: candidate.provider, model: candidate.model });
      try {
        const runtime = await executeResolvedPrompt({
          workspaceId: args.workspaceId,
          promptVersionId: version.id,
          promptName: getPromptName(version.prompts),
          versionTag: version.version_tag,
          templateText: version.template_text,
          variables,
          inputText: item.input,
          renderedPrompt,
          providerConfig: {
            providerType: providerCfg.config.provider_type,
            apiKey: providerCfg.apiKey,
            baseUrl: providerCfg.config.base_url,
            model: candidate.model,
            configId: providerCfg.config.id,
          },
          executorOverride: {
            type: "direct_provider",
            provider: candidate.provider,
            model: candidate.model,
          },
        });
        runtimeOutput = runtime.outputText;
        latencyMs = runtime.llmLatencyMs;
        tokensInput = asNumber(runtime.metadata.model?.input_tokens);
        tokensOutput = asNumber(runtime.metadata.model?.output_tokens) ?? asNumber(runtime.metadata.model?.total_tokens);
        finishStep(executionSteps, callIdx, "success", "Provider returned output");
      } catch (error) {
        runtimeError = error instanceof Error ? error.message : "Provider execution failed";
        finishStep(executionSteps, callIdx, "error", runtimeError);
      }

      const judgeInsert = await supabase
        .from("judge_executions")
        .insert({
          evaluation_run_id: run.id,
          evaluation_execution_id: execution.id,
          rubric_id: rubric.id,
          judge_provider: rubric.judgeProvider ?? candidate.provider,
          judge_model: rubric.judgeModel ?? candidate.model,
          status: runtimeError ? "failed" : "running",
        })
        .select("*")
        .single();
      if (judgeInsert.error || !judgeInsert.data) throw new Error(judgeInsert.error?.message ?? "Failed to create judge execution");
      const judgeRow = judgeInsert.data as JudgeExecutionRow;

      if (!runtimeError) {
        try {
          const judgeProviderType = rubric.judgeProvider ?? candidate.provider;
          const judgeCfg = await getProviderConfig(args.workspaceId, judgeProviderType);
          if (!judgeCfg) throw new Error(`Judge provider '${judgeProviderType}' is not configured`);
          const judgeModel = rubric.judgeModel ?? judgeCfg.config.default_model ?? candidate.model;
          const judgePrompt = buildJudgePrompt(rubric, item.input, item.context, runtimeOutput ?? "");
          const judgeRuntime = await executeResolvedPrompt({
            workspaceId: args.workspaceId,
            promptVersionId: version.id,
            promptName: "provider-arena-judge",
            versionTag: "judge-v1",
            templateText: judgePrompt,
            variables: {},
            inputText: "Return JSON only",
            renderedPrompt: judgePrompt,
            providerConfig: {
              providerType: judgeCfg.config.provider_type,
              apiKey: judgeCfg.apiKey,
              baseUrl: judgeCfg.config.base_url,
              model: judgeModel,
              configId: judgeCfg.config.id,
            },
            executorOverride: {
              type: "direct_provider",
              provider: judgeCfg.config.provider_type,
              model: judgeModel,
            },
          });
          const parsed = parseJudgeJson(judgeRuntime.outputText);
          const judgeOverall = clamp(asNumber(parsed.overall_score) ?? 0, 0, 100);
          const dims = Object.fromEntries(Object.entries(asRecord(parsed.dimension_scores)).map(([key, value]) => [key, clamp(asNumber(value) ?? 0, 0, 100)])) as Record<string, number>;
          const computed = computeWeightedScore(rubric, dims) ?? judgeOverall;
          const hardFailures = asArray(parsed.hard_failures).map((entry) => {
            const rec = asRecord(entry);
            return { rule: String(rec.rule ?? ""), severity: String(rec.severity ?? "medium"), reason: String(rec.reason ?? "") };
          }).filter((entry) => entry.rule.length > 0) as BehavioralJudgeHardFailure[];
          const criticalHardFail = hardFailures.some((entry) => entry.severity.toLowerCase() === "critical");
          const pass = !criticalHardFail && computed >= (rubric.passThreshold ?? 80);
          const conf = computeConfidence({
            judgeConfidence: clamp(asNumber(parsed.confidence) ?? 0.5, 0, 1),
            hasReference: Boolean(item.expectedOutput && item.expectedOutput.trim().length > 0),
            outputPresent: Boolean(runtimeOutput && runtimeOutput.trim().length > 0),
            hardFailures,
            executionStatus: "completed",
          });
          judgeResult = {
            overallScore: computed,
            judgeOverallScore: judgeOverall,
            computedScore: computed,
            pass,
            confidence: conf.score,
            confidenceLabel: conf.label,
            confidenceReasons: conf.reasons,
            dimensionScores: dims,
            hardFailures,
            strengths: asArray(parsed.strengths).map(String),
            weaknesses: asArray(parsed.weaknesses).map(String),
            riskFlags: asArray(parsed.risk_flags).map(String),
            verdictReason: asString(parsed.verdict_reason) ?? "",
            needsReview: conf.score < 0.6,
            rawJudgeOutput: parsed,
          };

          await supabase.from("judge_executions").update({
            status: "completed",
            overall_score: Number(computed.toFixed(2)),
            pass,
            confidence: Number(conf.score.toFixed(4)),
            dimension_scores: dims,
            hard_failures: hardFailures,
            strengths: judgeResult.strengths,
            weaknesses: judgeResult.weaknesses,
            risk_flags: judgeResult.riskFlags,
            verdict_reason: judgeResult.verdictReason,
            raw_judge_output: {
              ...parsed,
              execution_steps: executionSteps,
              candidate_id: candidate.id,
              expected_output: item.expectedOutput ?? null,
              rendered_prompt: renderedPrompt,
            },
          }).eq("id", judgeRow.id);
        } catch (error) {
          runtimeError = error instanceof Error ? error.message : "Judge execution failed";
          await supabase.from("judge_executions").update({
            status: "failed",
            verdict_reason: runtimeError,
            raw_judge_output: {
              error: runtimeError,
              execution_steps: executionSteps,
              candidate_id: candidate.id,
              expected_output: item.expectedOutput ?? null,
              rendered_prompt: renderedPrompt,
            },
          }).eq("id", judgeRow.id);
        }
      }

      await supabase.from("evaluation_executions").update({
        status: runtimeError ? "failed" : "completed",
        output: runtimeOutput,
        latency_ms: latencyMs,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        error: runtimeError,
      }).eq("id", execution.id);

      const estimatedCost = ((tokensInput ?? 0) + (tokensOutput ?? 0)) * 0.000001;
      const stat = candidateStats.get(candidate.id)!;
      if (judgeResult?.overallScore != null) stat.scores.push(judgeResult.overallScore);
      if (judgeResult?.pass) stat.pass += 1;
      stat.hardFails += judgeResult?.hardFailures.length ?? 0;
      if (judgeResult?.confidence != null) stat.confidence.push(judgeResult.confidence);
      if (latencyMs != null) stat.latencies.push(latencyMs);
      stat.costs.push(estimatedCost);
      if (judgeResult?.needsReview) stat.needsReview += 1;
      if (runtimeError) stat.failedCases += 1;
      stat.riskFlags += judgeResult?.riskFlags.length ?? 0;
      for (const [name, value] of Object.entries(judgeResult?.dimensionScores ?? {})) {
        stat.dims[name] = stat.dims[name] ?? [];
        stat.dims[name]!.push(value);
      }

      results.push({
        evaluationExecutionId: execution.id,
        datasetItemId: item.id,
        status: runtimeError ? "failed" : "completed",
        input: item.input,
        context: item.context,
        output: runtimeOutput,
        provider: candidate.provider,
        model: candidate.model,
        promptVersionId: version.id,
        latencyMs,
        tokensInput,
        tokensOutput,
        error: runtimeError,
        expectedOutput: item.expectedOutput ?? null,
        referenceOutput: item.expectedOutput ?? null,
        renderedPrompt,
        judge: judgeResult,
        executionSteps,
      });
    }
  }

  await runPairwiseComparisons({
    workspaceId: args.workspaceId,
    evaluationRunId: run.id,
    rubricId: rubric.id,
  });
  const pairwiseRows = (await getPairwiseForRun(run.id)) as PairwiseRow[];
  const executionCandidateMap = new Map<string, string>();
  for (const result of results) {
    const candidate = candidateRows.find(
      (row) => row.provider === result.provider && row.model === result.model,
    );
    if (candidate) executionCandidateMap.set(result.evaluationExecutionId, candidate.id);
  }
  const pairwiseByCandidate = new Map<string, {
    wins: number;
    losses: number;
    ties: number;
    bothBad: number;
    total: number;
    confidence: number[];
  }>();
  for (const candidate of candidateRows) {
    pairwiseByCandidate.set(candidate.id, { wins: 0, losses: 0, ties: 0, bothBad: 0, total: 0, confidence: [] });
  }
  for (const row of pairwiseRows) {
    const candidateA = executionCandidateMap.get(row.candidate_a_execution_id);
    const candidateB = executionCandidateMap.get(row.candidate_b_execution_id);
    if (!candidateA || !candidateB) continue;
    const statA = pairwiseByCandidate.get(candidateA);
    const statB = pairwiseByCandidate.get(candidateB);
    if (!statA || !statB) continue;
    const confidence = row.confidence ?? null;
    if (confidence != null) {
      statA.confidence.push(confidence);
      statB.confidence.push(confidence);
    }
    statA.total += 1;
    statB.total += 1;
    if (row.result === "a_wins") {
      statA.wins += 1;
      statB.losses += 1;
    } else if (row.result === "b_wins") {
      statA.losses += 1;
      statB.wins += 1;
    } else if (row.result === "tie") {
      statA.ties += 1;
      statB.ties += 1;
    } else if (row.result === "both_bad") {
      statA.bothBad += 1;
      statB.bothBad += 1;
    }
  }

  const candidateRowsWithScores = candidateRows.map((candidate) => {
    const stat = candidateStats.get(candidate.id)!;
    const pairwiseStat = pairwiseByCandidate.get(candidate.id) ?? { wins: 0, losses: 0, ties: 0, bothBad: 0, total: 0, confidence: [] };
    const totalCases = datasetItems.length;
    const averageScore = stat.scores.length ? stat.scores.reduce((a, b) => a + b, 0) / stat.scores.length : null;
    const passRate = totalCases > 0 ? stat.pass / totalCases : 0;
    const hardFailRate = totalCases > 0 ? stat.hardFails / totalCases : 0;
    const avgConfidence = stat.confidence.length ? stat.confidence.reduce((a, b) => a + b, 0) / stat.confidence.length : null;
    const avgLatency = stat.latencies.length ? stat.latencies.reduce((a, b) => a + b, 0) / stat.latencies.length : null;
    const sortedLatency = [...stat.latencies].sort((a, b) => a - b);
    const p95 = sortedLatency.length ? sortedLatency[Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * 0.95))] : null;
    const totalCost = stat.costs.reduce((a, b) => a + b, 0);
    const dimensionAverages = Object.fromEntries(
      Object.entries(stat.dims).map(([name, values]) => [name, values.reduce((a, b) => a + b, 0) / values.length]),
    );
    return {
      candidate,
      score: averageScore,
      passRate,
      hardFailRate,
      confidence: avgConfidence,
      latencyAvg: avgLatency,
      latencyP95: p95,
      costTotal: totalCost,
      dimensionAverages,
      needsReviewRate: totalCases > 0 ? stat.needsReview / totalCases : 0,
      failedCasesCount: stat.failedCases,
      riskFlagsCount: stat.riskFlags,
      pairwiseWinRate: pairwiseStat.total > 0 ? pairwiseStat.wins / pairwiseStat.total : null,
      pairwiseLossRate: pairwiseStat.total > 0 ? pairwiseStat.losses / pairwiseStat.total : null,
      tieRate: pairwiseStat.total > 0 ? pairwiseStat.ties / pairwiseStat.total : null,
      bothBadRate: pairwiseStat.total > 0 ? pairwiseStat.bothBad / pairwiseStat.total : null,
      pairwiseConfidenceAverage: pairwiseStat.confidence.length > 0
        ? pairwiseStat.confidence.reduce((a, b) => a + b, 0) / pairwiseStat.confidence.length
        : null,
    };
  });

  const ranked = normalizeArenaScores(candidateRowsWithScores);
  const best = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  const recommendation = best ? arenaRecommendation(best, second ?? undefined) : { value: "needs_review" as const, summary: "No successful candidate results available" };

  const failureClusters = ranked.flatMap((entry) => {
    const clusters: Array<Record<string, unknown>> = [];
    if (entry.hardFailRate > 0) {
      clusters.push({
        cluster_name: "Hard fail cluster",
        severity: entry.hardFailRate > 0.08 ? "critical" : "high",
        provider: entry.candidate.provider,
        model: entry.candidate.model,
        affected_cases_count: Math.round(entry.hardFailRate * datasetItems.length),
        recommended_action: "Review hard fail rules and output policy compliance before rollout",
      });
    }
    if (entry.riskFlagsCount > 0) {
      clusters.push({
        cluster_name: "Risk flag cluster",
        severity: "medium",
        provider: entry.candidate.provider,
        model: entry.candidate.model,
        affected_cases_count: entry.riskFlagsCount,
        recommended_action: "Inspect flagged cases and strengthen prompt constraints",
      });
    }
    return clusters;
  });

  const reportPayload = {
    recommended_candidate_id: best?.candidate.id ?? null,
    rollout_recommendation: recommendation.value,
    decision_score: best ? Number(best.decisionScore.toFixed(2)) : null,
    risk_score: best ? Number(best.riskScore.toFixed(2)) : null,
    summary: recommendation.summary,
    provider_rankings: ranked.map((entry, index) => ({
      rank: index + 1,
      provider_candidate_id: entry.candidate.id,
      provider: entry.candidate.provider,
      model: entry.candidate.model,
      label: entry.candidate.label,
      decision_score: Number(entry.decisionScore.toFixed(2)),
      average_score: entry.score != null ? Number(entry.score.toFixed(2)) : null,
      pass_rate: Number((entry.passRate * 100).toFixed(2)),
      pairwise_win_rate: entry.pairwiseWinRate != null ? Number((entry.pairwiseWinRate * 100).toFixed(2)) : null,
      pairwise_loss_rate: entry.pairwiseLossRate != null ? Number((entry.pairwiseLossRate * 100).toFixed(2)) : null,
      tie_rate: entry.tieRate != null ? Number((entry.tieRate * 100).toFixed(2)) : null,
      both_bad_rate: entry.bothBadRate != null ? Number((entry.bothBadRate * 100).toFixed(2)) : null,
      pairwise_confidence_average: entry.pairwiseConfidenceAverage != null ? Number((entry.pairwiseConfidenceAverage * 100).toFixed(2)) : null,
      hard_failure_rate: Number((entry.hardFailRate * 100).toFixed(2)),
      needs_review_rate: Number((entry.needsReviewRate * 100).toFixed(2)),
      average_confidence: entry.confidence != null ? Number((entry.confidence * 100).toFixed(2)) : null,
      average_latency_ms: entry.latencyAvg != null ? Number(entry.latencyAvg.toFixed(2)) : null,
      p95_latency_ms: entry.latencyP95 != null ? Number(entry.latencyP95.toFixed(2)) : null,
      estimated_cost_total: Number((entry.costTotal ?? 0).toFixed(6)),
      estimated_cost_per_execution: datasetItems.length > 0 ? Number((((entry.costTotal ?? 0)) / datasetItems.length).toFixed(6)) : null,
      risk_score: Number(entry.riskScore.toFixed(2)),
      failed_cases_count: entry.failedCasesCount,
      risk_flags_count: entry.riskFlagsCount,
      dimension_averages: entry.dimensionAverages,
    })),
    dimension_summary: Object.fromEntries(
      Array.from(new Set(ranked.flatMap((entry) => Object.keys(entry.dimensionAverages)))).map((dimension) => [
        dimension,
        ranked.map((entry) => ({
          provider_candidate_id: entry.candidate.id,
          provider: entry.candidate.provider,
          model: entry.candidate.model,
          average: entry.dimensionAverages[dimension] ?? null,
        })),
      ]),
    ),
    failure_clusters: failureClusters,
    cost_summary: {
      total_estimated_cost: Number(ranked.reduce((sum, entry) => sum + (entry.costTotal ?? 0), 0).toFixed(6)),
      by_candidate: ranked.map((entry) => ({
        provider_candidate_id: entry.candidate.id,
        provider: entry.candidate.provider,
        model: entry.candidate.model,
        total_cost: Number((entry.costTotal ?? 0).toFixed(6)),
        cost_per_execution: datasetItems.length > 0 ? Number(((entry.costTotal ?? 0) / datasetItems.length).toFixed(6)) : null,
      })),
    },
    latency_summary: {
      by_candidate: ranked.map((entry) => ({
        provider_candidate_id: entry.candidate.id,
        provider: entry.candidate.provider,
        model: entry.candidate.model,
        average_latency_ms: entry.latencyAvg,
        p95_latency_ms: entry.latencyP95,
      })),
    },
  };

  await supabase.from("arena_reports").upsert({
    evaluation_run_id: run.id,
    ...reportPayload,
  }, { onConflict: "evaluation_run_id" });

  await buildReviewQueueForRun({
    workspaceId: args.workspaceId,
    evaluationRunId: run.id,
  });

  await updateRun(run.id, {
    status: "completed",
    completed_at: nowIso(),
    summary: {
      total: results.length,
      completed: results.filter((row) => row.status === "completed").length,
      failed: results.filter((row) => row.status === "failed").length,
      pass_count: results.filter((row) => row.judge?.pass).length,
      fail_count: results.filter((row) => row.judge && !row.judge.pass).length,
      needs_review_count: results.filter((row) => row.judge?.needsReview).length,
      average_score: ranked.length ? ranked.reduce((sum, row) => sum + (row.score ?? 0), 0) / ranked.length : null,
      hard_failure_count: results.reduce((sum, row) => sum + (row.judge?.hardFailures.length ?? 0), 0),
      pass_threshold: rubric.passThreshold,
      passed: recommendation.value === "safe_to_rollout",
      dimension_averages: reportPayload.dimension_summary,
      arena: {
        candidate_count: candidateRows.length,
        estimated_provider_executions: datasetItems.length * candidateRows.length,
        estimated_judge_executions: datasetItems.length * candidateRows.length,
      },
    },
  });

  const view = await getProviderArenaRunDetail(args.workspaceId, run.id);
  if (!view) throw new Error("Failed to load provider arena run");
  return view;
}

async function listArenaRunRows(workspaceId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("evaluation_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("run_type", "provider_arena")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as EvaluationRunRow[];
}

async function getArenaReport(runId: string): Promise<ArenaReportRow | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase.from("arena_reports").select("*").eq("evaluation_run_id", runId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ArenaReportRow | null) ?? null;
}

async function getProviderCandidates(runId: string): Promise<ProviderCandidateRow[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase.from("provider_candidates").select("*").eq("evaluation_run_id", runId).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProviderCandidateRow[];
}

export async function listProviderArenaRuns(workspaceId: string): Promise<BehavioralEvaluationRunView[]> {
  await assertFeatureAccess(workspaceId, "behavioral_evaluations");
  const rows = await listArenaRunRows(workspaceId);
  const views = await Promise.all(rows.map((row) => getProviderArenaRunDetail(workspaceId, row.id)));
  return views.filter((row): row is BehavioralEvaluationRunView => row !== null);
}

export async function getProviderArenaRunDetail(workspaceId: string, runId: string): Promise<BehavioralEvaluationRunView | null> {
  await assertFeatureAccess(workspaceId, "behavioral_evaluations");
  const run = await getRunRow(workspaceId, runId);
  if (!run || run.run_type !== "provider_arena") return null;
  const [base, candidates, report, pairwiseRows, reviewQueue] = await Promise.all([
    getBehavioralRunDetail(workspaceId, runId),
    getProviderCandidates(runId),
    getArenaReport(runId),
    getPairwiseForRun(runId),
    getReviewQueueSummary(workspaceId, runId),
  ]);
  if (!base) return null;
  const pairwise = (pairwiseRows as PairwiseRow[]) ?? [];
  const executionToCandidate = new Map<string, string>();
  for (const result of base.results) {
    const candidate = candidates.find((row) => row.provider === result.provider && row.model === result.model);
    if (candidate) executionToCandidate.set(result.evaluationExecutionId, candidate.id);
  }
  const matrixAccumulator = new Map<string, { wins: number; total: number }>();
  const resultCounts: Record<"a_wins" | "b_wins" | "tie" | "both_bad" | "needs_review", number> = {
    a_wins: 0,
    b_wins: 0,
    tie: 0,
    both_bad: 0,
    needs_review: 0,
  };
  for (const row of pairwise) {
    resultCounts[row.result] += 1;
    const candidateA = executionToCandidate.get(row.candidate_a_execution_id);
    const candidateB = executionToCandidate.get(row.candidate_b_execution_id);
    if (!candidateA || !candidateB || candidateA === candidateB) continue;
    const keyAB = `${candidateA}:${candidateB}`;
    const keyBA = `${candidateB}:${candidateA}`;
    const accAB = matrixAccumulator.get(keyAB) ?? { wins: 0, total: 0 };
    const accBA = matrixAccumulator.get(keyBA) ?? { wins: 0, total: 0 };
    accAB.total += 1;
    accBA.total += 1;
    if (row.result === "a_wins") {
      accAB.wins += 1;
    } else if (row.result === "b_wins") {
      accBA.wins += 1;
    } else if (row.result === "tie") {
      accAB.wins += 0.5;
      accBA.wins += 0.5;
    }
    matrixAccumulator.set(keyAB, accAB);
    matrixAccumulator.set(keyBA, accBA);
  }
  const matrix = candidates.flatMap((rowCandidate) => candidates.map((colCandidate) => {
    if (rowCandidate.id === colCandidate.id) {
      return {
        rowCandidateId: rowCandidate.id,
        colCandidateId: colCandidate.id,
        winRate: null,
        sampleSize: 0,
      };
    }
    const acc = matrixAccumulator.get(`${rowCandidate.id}:${colCandidate.id}`) ?? { wins: 0, total: 0 };
    return {
      rowCandidateId: rowCandidate.id,
      colCandidateId: colCandidate.id,
      winRate: acc.total > 0 ? Number((acc.wins / acc.total).toFixed(4)) : null,
      sampleSize: acc.total,
    };
  }));

  return {
    ...base,
    runType: "provider_arena",
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      provider: candidate.provider,
      model: candidate.model,
      label: candidate.label,
      temperature: candidate.temperature,
      maxTokens: candidate.max_tokens,
      config: candidate.config,
    })),
    arenaReport: report
      ? {
          id: report.id,
          recommendedCandidateId: report.recommended_candidate_id,
          rolloutRecommendation: report.rollout_recommendation,
          decisionScore: report.decision_score,
          riskScore: report.risk_score,
          summary: report.summary,
          providerRankings: (report.provider_rankings ?? []) as Array<Record<string, unknown>>,
          dimensionSummary: report.dimension_summary ?? {},
          failureClusters: (report.failure_clusters ?? []) as Array<Record<string, unknown>>,
          costSummary: report.cost_summary ?? {},
          latencySummary: report.latency_summary ?? {},
        }
      : null,
    pairwise: {
      total: pairwise.length,
      byResult: resultCounts,
      matrix,
      comparisons: pairwise.map((row) => ({
        id: row.id,
        datasetItemId: row.dataset_item_id,
        candidateAExecutionId: row.candidate_a_execution_id,
        candidateBExecutionId: row.candidate_b_execution_id,
        winnerExecutionId: row.winner_execution_id,
        result: row.result,
        confidence: row.confidence,
        reasoning: row.reasoning,
        dimensionPreferences: Object.fromEntries(
          Object.entries((row.dimension_preferences ?? {}) as Record<string, unknown>).filter((entry) => {
            const value = String(entry[1]);
            return value === "a" || value === "b" || value === "tie";
          }),
        ) as Record<string, "a" | "b" | "tie">,
        blindOrder: row.blind_order ?? {},
        riskFlags: asArray(row.risk_flags).map((entry) => String(entry)),
        needsReviewReason: row.needs_review_reason,
        createdAt: row.created_at,
      })),
    },
    reviewQueue: reviewQueue ?? null,
  };
}
