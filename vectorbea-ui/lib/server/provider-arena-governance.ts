import "server-only";

import { randomUUID } from "crypto";

import { executeResolvedPrompt } from "@/lib/server/execution";
import { getProviderConfig } from "@/lib/server/provider-keys";
import { getRubricWithDetails } from "@/lib/server/rubrics";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { buildTraceMetadataV1 } from "@/lib/trace-metadata";

type PairwiseResult = "a_wins" | "b_wins" | "tie" | "both_bad" | "needs_review";

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
  return trimmed.length > 0 ? trimmed : null;
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

async function insertGovernanceAudit(args: {
  workspaceId: string;
  promptName: string;
  versionTag: string;
  action: string;
  payload?: Record<string, unknown>;
}) {
  const supabase = createVectorBeaAdminClient();
  const metadata = buildTraceMetadataV1({
    useType: "audit",
    promptName: args.promptName,
    versionTag: args.versionTag,
    metadata: {
      custom: {
        audit: {
          action: args.action,
          ...args.payload,
        },
      },
    },
  });
  await supabase.from("audit_logs").insert({
    workspace_id: args.workspaceId,
    prompt_name: args.promptName,
    version_tag: args.versionTag,
    proxy_latency_ms: 0,
    llm_latency_ms: 0,
    token_count: 0,
    metadata,
  });
}

function parsePairwise(raw: string): {
  result: PairwiseResult;
  confidence: number;
  dimensionPreferences: Record<string, "a" | "b" | "tie">;
  winnerReason: string;
  riskFlags: string[];
  needsReviewReason: string | null;
} {
  const trimmed = raw.trim();
  let jsonText = trimmed;
  if (trimmed.startsWith("```")) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match?.[1]) jsonText = match[1];
  }
  const parsed = asRecord(JSON.parse(jsonText));
  const result = asString(parsed.result) as PairwiseResult;
  const allowed = new Set<PairwiseResult>(["a_wins", "b_wins", "tie", "both_bad", "needs_review"]);
  if (!allowed.has(result)) throw new Error("Invalid pairwise result");
  const confidence = clamp(asNumber(parsed.confidence) ?? 0.5, 0, 1);
  const prefs = asRecord(parsed.dimension_preferences);
  const dimensionPreferences: Record<string, "a" | "b" | "tie"> = {};
  for (const [key, value] of Object.entries(prefs)) {
    const pick = asString(value);
    if (pick === "a" || pick === "b" || pick === "tie") dimensionPreferences[key] = pick;
  }
  return {
    result,
    confidence,
    dimensionPreferences,
    winnerReason: asString(parsed.winner_reason) ?? "",
    riskFlags: asArray(parsed.risk_flags).map((entry) => String(entry)),
    needsReviewReason: asString(parsed.needs_review_reason),
  };
}

function buildPairwiseJudgePrompt(args: {
  rubricGoal: string | null;
  promptType: string;
  dimensions: Array<{ name: string; description: string | null; weight: number }>;
  rules: Array<{ ruleType: string; description: string; severity: string }>;
  input: string;
  context: string | null;
  outputA: string;
  outputB: string;
}) {
  return [
    "You are an enterprise rubric judge for pairwise LLM output comparison",
    "Compare Output A and Output B for the same input",
    "Provider identity is hidden and must not be inferred",
    "Do not reward verbosity alone",
    "Identify policy and safety failures",
    "Return JSON only",
    "",
    `Rubric goal: ${args.rubricGoal ?? "N/A"}`,
    `Prompt type: ${args.promptType}`,
    `Dimensions: ${JSON.stringify(args.dimensions)}`,
    `Rules: ${JSON.stringify(args.rules)}`,
    "",
    `Input: ${args.input}`,
    `Context: ${args.context ?? ""}`,
    `Output A: ${args.outputA}`,
    `Output B: ${args.outputB}`,
    "",
    "Return schema:",
    JSON.stringify({
      result: "a_wins | b_wins | tie | both_bad | needs_review",
      confidence: 0.0,
      dimension_preferences: { dimension_name: "a | b | tie" },
      winner_reason: "short reason",
      risk_flags: ["string"],
      needs_review_reason: "string or null",
    }),
  ].join("\n");
}

export async function runPairwiseComparisons(args: { workspaceId: string; evaluationRunId: string; rubricId: string }) {
  const supabase = createVectorBeaAdminClient();
  const rubric = await getRubricWithDetails(args.rubricId);
  if (!rubric) return;

  const [execRes, candidatesRes] = await Promise.all([
    supabase
      .from("evaluation_executions")
      .select("id,dataset_item_id,provider_candidate_id,input,context,output,error")
      .eq("evaluation_run_id", args.evaluationRunId),
    supabase
      .from("provider_candidates")
      .select("id,provider,model")
      .eq("evaluation_run_id", args.evaluationRunId),
  ]);
  if (execRes.error || !execRes.data?.length) return;
  if (candidatesRes.error || !candidatesRes.data?.length) return;

  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const row of execRes.data) {
    const key = String(row.dataset_item_id);
    grouped.set(key, [...(grouped.get(key) ?? []), row as unknown as Record<string, unknown>]);
  }

  const judgeProviderType = rubric.judgeProvider ?? String(candidatesRes.data[0].provider);
  const judgeProvider = await getProviderConfig(args.workspaceId, judgeProviderType);
  if (!judgeProvider) return;
  const judgeModel = rubric.judgeModel ?? judgeProvider.config.default_model ?? "gpt-4o-mini";

  const inserts: Array<Record<string, unknown>> = [];
  for (const [datasetItemId, rows] of grouped.entries()) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!;
        const b = rows[j]!;
        const outputA = asString(a.output) ?? "";
        const outputB = asString(b.output) ?? "";
        const orderToken = randomUUID();
        const swap = orderToken.charCodeAt(0) % 2 === 0;
        const blindA = swap ? outputB : outputA;
        const blindB = swap ? outputA : outputB;
        const prompt = buildPairwiseJudgePrompt({
          rubricGoal: rubric.goal,
          promptType: rubric.promptType,
          dimensions: (rubric.dimensions ?? []).map((entry) => ({ name: entry.name, description: entry.description, weight: entry.weight })),
          rules: (rubric.rules ?? []).map((entry) => ({ ruleType: entry.ruleType, description: entry.description, severity: entry.severity })),
          input: asString(a.input) ?? "",
          context: asString(a.context),
          outputA: blindA,
          outputB: blindB,
        });
        let result: PairwiseResult = "needs_review";
        let confidence = 0;
        let reason = "Pairwise judge failed";
        let prefs: Record<string, "a" | "b" | "tie"> = {};
        let riskFlags: string[] = [];
        let needsReviewReason: string | null = "Judge confidence is low";
        try {
          const judgeRuntime = await executeResolvedPrompt({
            workspaceId: args.workspaceId,
            promptVersionId: null,
            promptName: "pairwise-judge",
            versionTag: "v1",
            templateText: prompt,
            variables: {},
            inputText: "Return JSON only",
            renderedPrompt: prompt,
            providerConfig: {
              providerType: judgeProvider.config.provider_type,
              apiKey: judgeProvider.apiKey,
              baseUrl: judgeProvider.config.base_url,
              model: judgeModel,
              configId: judgeProvider.config.id,
            },
            executorOverride: {
              type: "direct_provider",
              provider: judgeProvider.config.provider_type,
              model: judgeModel,
            },
          });
          const parsed = parsePairwise(judgeRuntime.outputText);
          result = parsed.result;
          confidence = parsed.confidence;
          prefs = parsed.dimensionPreferences;
          reason = parsed.winnerReason;
          riskFlags = parsed.riskFlags;
          needsReviewReason = parsed.needsReviewReason;
          if (confidence < 0.6 && result !== "needs_review") {
            result = "needs_review";
            needsReviewReason = needsReviewReason ?? "Judge confidence below threshold";
          }
        } catch (error) {
          reason = error instanceof Error ? error.message : "Pairwise judge execution failed";
        }
        const mappedResult = swap
          ? (result === "a_wins" ? "b_wins" : result === "b_wins" ? "a_wins" : result)
          : result;
        const winnerExecutionId =
          mappedResult === "a_wins" ? String(a.id) :
          mappedResult === "b_wins" ? String(b.id) :
          null;
        inserts.push({
          evaluation_run_id: args.evaluationRunId,
          dataset_item_id: datasetItemId,
          candidate_a_execution_id: a.id,
          candidate_b_execution_id: b.id,
          winner_execution_id: winnerExecutionId,
          result: mappedResult,
          confidence,
          reasoning: reason,
          dimension_preferences: prefs,
          judge_provider: judgeProviderType,
          judge_model: judgeModel,
          blind_order: {
            randomized: true,
            order_token: orderToken,
            blind_a_source: swap ? "b" : "a",
            blind_b_source: swap ? "a" : "b",
          },
          risk_flags: riskFlags,
          needs_review_reason: needsReviewReason,
        });
      }
    }
  }
  if (inserts.length > 0) {
    await supabase.from("pairwise_comparisons").insert(inserts);
  }
  await insertGovernanceAudit({
    workspaceId: args.workspaceId,
    promptName: "provider-arena",
    versionTag: "pairwise",
    action: "provider_arena_pairwise_completed",
    payload: { evaluation_run_id: args.evaluationRunId, pairwise_count: inserts.length },
  });
}

export async function buildReviewQueueForRun(args: { workspaceId: string; evaluationRunId: string }) {
  const supabase = createVectorBeaAdminClient();
  const [execRes, pairwiseRes] = await Promise.all([
    supabase
      .from("judge_executions")
      .select("evaluation_execution_id, confidence, hard_failures, risk_flags, raw_judge_output")
      .eq("evaluation_run_id", args.evaluationRunId),
    supabase
      .from("pairwise_comparisons")
      .select("id,dataset_item_id,result,confidence,needs_review_reason")
      .eq("evaluation_run_id", args.evaluationRunId),
  ]);
  if (execRes.error || pairwiseRes.error) return;
  const reviewRows: Array<Record<string, unknown>> = [];
  for (const row of execRes.data ?? []) {
    const confidence = asNumber(row.confidence) ?? 0;
    const hardFails = asArray(row.hard_failures);
    const riskFlags = asArray(row.risk_flags);
    if (confidence < 0.6 || hardFails.length > 0 || riskFlags.length > 0) {
      reviewRows.push({
        workspace_id: args.workspaceId,
        evaluation_run_id: args.evaluationRunId,
        evaluation_execution_id: row.evaluation_execution_id,
        status: "open",
        reason: confidence < 0.6 ? "Low judge confidence" : hardFails.length > 0 ? "Hard failures detected" : "Risk flags detected",
        severity: hardFails.some((entry) => String(asRecord(entry).severity ?? "").toLowerCase() === "critical") ? "critical" : confidence < 0.5 ? "high" : "medium",
      });
    }
  }
  for (const row of pairwiseRes.data ?? []) {
    if (row.result === "needs_review" || (row.confidence ?? 0) < 0.6) {
      reviewRows.push({
        workspace_id: args.workspaceId,
        evaluation_run_id: args.evaluationRunId,
        dataset_item_id: row.dataset_item_id,
        pairwise_comparison_id: row.id,
        status: "open",
        reason: row.needs_review_reason ?? "Pairwise result needs review",
        severity: (row.confidence ?? 0) < 0.45 ? "high" : "medium",
      });
    }
  }
  if (reviewRows.length > 0) {
    await supabase.from("human_review_items").insert(reviewRows);
  }
  await insertGovernanceAudit({
    workspaceId: args.workspaceId,
    promptName: "provider-arena",
    versionTag: "review-queue",
    action: "human_review_items_generated",
    payload: { evaluation_run_id: args.evaluationRunId, review_item_count: reviewRows.length },
  });
}

export async function listReviewQueue(workspaceId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("human_review_items")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getReviewQueueSummary(workspaceId: string, evaluationRunId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("human_review_items")
    .select("status,severity")
    .eq("workspace_id", workspaceId)
    .eq("evaluation_run_id", evaluationRunId);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const open = rows.filter((row) => String(row.status) === "open").length;
  const inReview = rows.filter((row) => String(row.status) === "in_review").length;
  const criticalOpen = rows.filter((row) => String(row.status) === "open" && String(row.severity).toLowerCase() === "critical").length;
  return { open, inReview, criticalOpen };
}

export async function updateReviewItem(args: {
  workspaceId: string;
  id: string;
  status?: "open" | "in_review" | "resolved" | "dismissed";
  assignedTo?: string | null;
  reviewerDecision?: string | null;
  reviewerNotes?: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const patch: Record<string, unknown> = {};
  if (args.status) patch.status = args.status;
  if (args.assignedTo !== undefined) patch.assigned_to = args.assignedTo;
  if (args.reviewerDecision !== undefined) patch.reviewer_decision = args.reviewerDecision;
  if (args.reviewerNotes !== undefined) patch.reviewer_notes = args.reviewerNotes;
  if (args.status === "resolved" || args.status === "dismissed") patch.reviewed_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("human_review_items")
    .update(patch)
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await insertGovernanceAudit({
    workspaceId: args.workspaceId,
    promptName: "provider-arena",
    versionTag: "review-item",
    action: "human_review_decision_submitted",
    payload: { review_item_id: args.id, status: args.status ?? data.status, reviewer_decision: args.reviewerDecision ?? null },
  });
  return data;
}

export async function getPairwiseForRun(evaluationRunId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("pairwise_comparisons")
    .select("*")
    .eq("evaluation_run_id", evaluationRunId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function computeEvaluationRunComparison(args: {
  workspaceId: string;
  runIds: string[];
  createdBy: string;
}) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("evaluation_runs")
    .select("id,run_type,status,summary,created_at")
    .eq("workspace_id", args.workspaceId)
    .in("id", args.runIds);
  if (error) throw new Error(error.message);
  const runs = (data ?? []) as Array<Record<string, unknown>>;
  if (runs.length < 2) throw new Error("At least two evaluation runs are required");
  runs.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const first = asRecord(runs[0]?.summary);
  const last = asRecord(runs[runs.length - 1]?.summary);
  const scoreDelta = (asNumber(last.average_score) ?? 0) - (asNumber(first.average_score) ?? 0);
  const passDelta = (asNumber(last.pass_count) ?? 0) - (asNumber(first.pass_count) ?? 0);
  const failDelta = (asNumber(last.fail_count) ?? 0) - (asNumber(first.fail_count) ?? 0);
  const latencyDelta = (asNumber(last.average_latency_ms) ?? 0) - (asNumber(first.average_latency_ms) ?? 0);
  const costDelta = (asNumber(asRecord(last.arena).total_estimated_cost) ?? 0) - (asNumber(asRecord(first.arena).total_estimated_cost) ?? 0);
  const dimKeys = new Set([...Object.keys(asRecord(first.dimension_averages)), ...Object.keys(asRecord(last.dimension_averages))]);
  const dimensionDeltas: Record<string, number> = {};
  for (const key of dimKeys) {
    const start = asNumber(asRecord(first.dimension_averages)[key]) ?? 0;
    const end = asNumber(asRecord(last.dimension_averages)[key]) ?? 0;
    dimensionDeltas[key] = Number((end - start).toFixed(3));
  }
  const summary = scoreDelta >= 0
    ? "Recent run improved quality score compared with baseline run"
    : "Recent run regressed quality score compared with baseline run";

  const payload = {
    workspace_id: args.workspaceId,
    created_by: args.createdBy,
    run_ids: args.runIds,
    summary,
    score_delta: { absolute: scoreDelta },
    pass_rate_delta: { absolute: passDelta },
    failure_delta: { absolute: failDelta },
    dimension_deltas: dimensionDeltas,
    cost_delta: { absolute: Number(costDelta.toFixed(6)) },
    latency_delta: { absolute: Number(latencyDelta.toFixed(2)) },
    regression_cases: [],
    improvement_cases: [],
  };
  const { data: inserted, error: insertError } = await supabase
    .from("evaluation_comparison_reports")
    .insert(payload)
    .select("*")
    .single();
  if (insertError) throw new Error(insertError.message);
  return inserted;
}

export async function evaluateRolloutGate(args: {
  workspaceId: string;
  promptId: string;
  promptVersionId: string;
  checkedBy: string;
  targetEnvironment?: string;
}) {
  const supabase = createVectorBeaAdminClient();
  const [promptRow, versionRow] = await Promise.all([
    supabase
      .from("prompts")
      .select("name")
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.promptId)
      .maybeSingle(),
    supabase
      .from("prompt_versions")
      .select("version_tag")
      .eq("id", args.promptVersionId)
      .maybeSingle(),
  ]);
  const [arenaRes, behaviorRes, reviewsRes] = await Promise.all([
    supabase
      .from("evaluation_runs")
      .select("id, summary, run_type, created_at")
      .eq("workspace_id", args.workspaceId)
      .eq("prompt_id", args.promptId)
      .eq("prompt_version_id", args.promptVersionId)
      .eq("run_type", "provider_arena")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("evaluation_runs")
      .select("id, summary, run_type, created_at")
      .eq("workspace_id", args.workspaceId)
      .eq("prompt_id", args.promptId)
      .eq("prompt_version_id", args.promptVersionId)
      .eq("run_type", "behavioral_rubric")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("human_review_items")
      .select("id,severity,status")
      .eq("workspace_id", args.workspaceId)
      .eq("status", "open"),
  ]);
  if (arenaRes.error || behaviorRes.error || reviewsRes.error) {
    throw new Error(arenaRes.error?.message ?? behaviorRes.error?.message ?? reviewsRes.error?.message ?? "Failed rollout gate checks");
  }

  const reasons: string[] = [];
  const evalIds: string[] = [];
  let decision: "safe_to_rollout" | "rollout_with_caution" | "needs_review" | "do_not_rollout" = "safe_to_rollout";
  let status: "passed" | "blocked" | "needs_review" = "passed";
  let riskScore: number | null = null;

  const arena = (arenaRes.data ?? [])[0] as Record<string, unknown> | undefined;
  const behavioral = (behaviorRes.data ?? [])[0] as Record<string, unknown> | undefined;
  if (behavioral) evalIds.push(String(behavioral.id));
  if (arena) evalIds.push(String(arena.id));

  // Behavioral eval is optional — only block if it exists and explicitly failed
  if (behavioral) {
    const behavioralSummary = asRecord(behavioral.summary);
    const behavioralPassed = Boolean(behavioralSummary.passed);
    if (!behavioralPassed) {
      reasons.push("Behavioral evaluation did not pass");
      decision = "needs_review";
      status = "needs_review";
    }
  }

  // Provider Arena run is optional — only factor in if a run exists
  if (arena) {
    const arenaSummary = asRecord(arena.summary);
    const maybeRisk = asNumber(arenaSummary.risk_score ?? asRecord(arenaSummary.arena_report).risk_score);
    if (maybeRisk != null) riskScore = maybeRisk;
    const recommendation = String(arenaSummary.rollout_recommendation ?? asRecord(arenaSummary.arena_report).rollout_recommendation ?? "");
    if (recommendation === "do_not_rollout") {
      reasons.push("Provider Arena recommends do not rollout");
      decision = "do_not_rollout";
      status = "blocked";
    } else if (recommendation === "needs_review") {
      reasons.push("Provider Arena recommends manual review");
      decision = "needs_review";
      status = "needs_review";
    } else if (recommendation === "rollout_with_caution" && status === "passed") {
      decision = "rollout_with_caution";
    }
  }

  const openCriticalReviews = (reviewsRes.data ?? []).filter((entry) => String(entry.severity).toLowerCase() === "critical");
  if (openCriticalReviews.length > 0) {
    reasons.push(`${openCriticalReviews.length} critical human review items are unresolved`);
    decision = "do_not_rollout";
    status = "blocked";
  }

  const payload = {
    workspace_id: args.workspaceId,
    prompt_id: args.promptId,
    prompt_version_id: args.promptVersionId,
    target_environment: args.targetEnvironment ?? "production",
    status,
    checked_by: args.checkedBy,
    checked_at: new Date().toISOString(),
    reasons,
    evaluation_run_ids: evalIds,
    risk_score: riskScore,
    decision,
  };
  const { data, error } = await supabase
    .from("rollout_gate_checks")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await insertGovernanceAudit({
    workspaceId: args.workspaceId,
    promptName: "rollout-gate",
    versionTag: "v1",
    action: status === "passed" ? "rollout_gate_passed" : "rollout_gate_blocked",
    payload: {
      prompt_id: args.promptId,
      prompt_version_id: args.promptVersionId,
      status,
      decision,
      reasons,
      evaluation_run_ids: evalIds,
    },
  });

  if (status === "blocked") {
    try {
      const { notifyRolloutBlocked } = await import("@/lib/server/notifications");
      await notifyRolloutBlocked({
        workspaceId: args.workspaceId,
        promptName: String(promptRow.data?.name ?? args.promptId),
        promptId: args.promptId,
        versionTag: String(versionRow.data?.version_tag ?? args.promptVersionId),
        reasons,
        rolloutCheckId: String(data.id),
        requestedBy: args.checkedBy,
        targetEnvironment: args.targetEnvironment ?? "production",
      });
    } catch {
      // Notification failures must not break rollout gate checks
    }
  }

  return data;
}
