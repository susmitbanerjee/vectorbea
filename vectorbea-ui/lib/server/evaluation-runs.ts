import "server-only";

import { randomUUID } from "crypto";

import type { TraceEvaluationCheckView, TraceSetEvaluationRunView } from "@/lib/api";
import { evaluateTraceReplay, toMetadataEvaluation } from "@/lib/server/trace-compare";
import { executeResolvedPrompt } from "@/lib/server/execution";
import { isRuntimeTraceRow, mapAuditRowToTraceDetail, type AuditLogTraceRow } from "@/lib/server/traces";
import { buildTraceMetadataV1, normalizeTraceMetadataV1 } from "@/lib/trace-metadata";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

type PromptVersionRecord = {
  id: string;
  prompt_id: string;
  version_tag: string;
  template_text: string;
  parameters: Record<string, unknown> | null;
  prompts: { id?: string; name?: string } | Array<{ id?: string; name?: string }> | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function aggregateObservability(values: Array<string | null | undefined>): TraceSetEvaluationRunView["aggregate"]["observabilityLevel"] {
  if (values.some((value) => value === "minimal")) return "minimal";
  if (values.some((value) => value === "partial")) return "partial";
  if (values.some((value) => value === "unknown")) return "unknown";
  return "full";
}

function defaultReview(): TraceSetEvaluationRunView["review"] {
  return {
    status: "pending_review",
    decision: null,
    reviewerId: null,
    reviewerNote: null,
    reviewedAt: null,
  };
}

function buildPromotionGate(input: {
  status: TraceSetEvaluationRunView["status"];
  review: TraceSetEvaluationRunView["review"];
  recommendation: TraceSetEvaluationRunView["aggregate"]["recommendation"];
  criticalFailures: number;
  confidence: number | null;
  failed: number;
}): TraceSetEvaluationRunView["promotion"] {
  const reasons: string[] = [];
  if (input.status !== "completed" && input.status !== "approved") {
    reasons.push("Evaluation run is not completed");
  }
  if (input.review.status !== "approved") {
    reasons.push("Human review is not approved");
  }
  if (input.criticalFailures > 0) {
    reasons.push("One or more critical checks failed");
  }
  if (input.recommendation === "blocked" || input.recommendation === "regression_detected") {
    reasons.push("Evaluation recommendation indicates regression");
  }
  if (input.failed > 0) {
    reasons.push("Some replay traces failed execution");
  }
  if (input.confidence !== null && input.confidence < 0.55) {
    reasons.push("Evaluation confidence is low because observability is incomplete");
  }
  return {
    allowed: reasons.length === 0,
    reasons,
  };
}

function renderTemplate(template: string, variables: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  });
}

function getPromptRow(version: PromptVersionRecord) {
  return Array.isArray(version.prompts) ? version.prompts[0] ?? null : version.prompts ?? null;
}

function toRunView(row: AuditLogTraceRow): TraceSetEvaluationRunView | null {
  const normalized = normalizeTraceMetadataV1(row.metadata ?? {});
  const custom = asRecord(normalized.custom);
  const payload = asRecord(custom.evaluation_run);
  if (!payload.id) return null;

  const aggregate = asRecord(payload.aggregate);
  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const reviewPayload = asRecord(payload.review);
  const review: TraceSetEvaluationRunView["review"] = {
    status: (asString(reviewPayload.status) as TraceSetEvaluationRunView["review"]["status"]) ?? "pending_review",
    decision: (asString(reviewPayload.decision) as TraceSetEvaluationRunView["review"]["decision"]) ?? null,
    reviewerId: asString(reviewPayload.reviewer_id ?? reviewPayload.reviewerId),
    reviewerNote: asString(reviewPayload.reviewer_note ?? reviewPayload.reviewerNote),
    reviewedAt: asString(reviewPayload.reviewed_at ?? reviewPayload.reviewedAt),
  };

  const confidenceValue = Number(aggregate.confidence ?? Number.NaN);
  const recommendation = (asString(aggregate.recommendation) as TraceSetEvaluationRunView["aggregate"]["recommendation"]) ?? "needs_review";
  const criticalFailures = Number(aggregate.critical_failures ?? 0);
  const failed = Number(aggregate.failed ?? 0);
  const status = (asString(payload.status) as TraceSetEvaluationRunView["status"]) ?? "completed";

  return {
    id: String(payload.id),
    workspaceId: row.workspace_id,
    status,
    promptName: asString(payload.prompt_name) ?? row.prompt_name ?? "unknown-prompt",
    candidatePromptVersionId: asString(payload.candidate_prompt_version_id) ?? "",
    candidateVersionTag: asString(payload.candidate_version_tag) ?? row.version_tag ?? "latest",
    sourceTraceIds: Array.isArray(payload.source_trace_ids) ? payload.source_trace_ids.map(String) : [],
    replayTraceIds: Array.isArray(payload.replay_trace_ids) ? payload.replay_trace_ids.map(String) : [],
    createdAt: row.created_at,
    aggregate: {
      total: Number(aggregate.total ?? 0),
      succeeded: Number(aggregate.succeeded ?? 0),
      failed: Number(aggregate.failed ?? 0),
      outputChanged: Number(aggregate.output_changed ?? 0),
      latencyImproved: Number(aggregate.latency_improved ?? 0),
      latencyRegressed: Number(aggregate.latency_regressed ?? 0),
      unavailableObservability: Number(aggregate.unavailable_observability ?? 0),
      averageLatencyDeltaMs: typeof aggregate.average_latency_delta_ms === "number" ? aggregate.average_latency_delta_ms : null,
      averageTokenDelta: typeof aggregate.average_token_delta === "number" ? aggregate.average_token_delta : null,
      score: typeof aggregate.score === "number" ? aggregate.score : null,
      confidence: Number.isFinite(confidenceValue) ? confidenceValue : null,
      criticalFailures,
      observabilityLevel: (asString(aggregate.observability_level) as TraceSetEvaluationRunView["aggregate"]["observabilityLevel"]) ?? "unknown",
      recommendation,
      reasons: Array.isArray(aggregate.reasons) ? aggregate.reasons.map(String) : [],
    },
    results: rawResults.map((entry) => {
      const result = asRecord(entry);
      const confidence = Number(result.confidence ?? Number.NaN);
      const rawChecks = Array.isArray(result.checks) ? result.checks : [];
      return {
        sourceTraceId: asString(result.source_trace_id) ?? "",
        replayTraceId: asString(result.replay_trace_id),
        score: typeof result.score === "number" ? result.score : null,
        label: (asString(result.label) as TraceSetEvaluationRunView["results"][number]["label"]) ?? "unknown",
        status: (asString(result.status) as TraceSetEvaluationRunView["results"][number]["status"]) ?? "error",
        latencyDeltaMs: typeof result.latency_delta_ms === "number" ? result.latency_delta_ms : null,
        tokenDelta: typeof result.token_delta === "number" ? result.token_delta : null,
        confidence: Number.isFinite(confidence) ? confidence : null,
        recommendation: (asString(result.recommendation) as TraceSetEvaluationRunView["results"][number]["recommendation"]) ?? "needs_review",
        criticalFailures: Number(result.critical_failures ?? 0),
        observabilityNote: asString(result.observability_note),
        replayMode: (asString(result.replay_mode) as TraceSetEvaluationRunView["results"][number]["replayMode"]) ?? null,
        checks: rawChecks.map((entry) => {
          const check = asRecord(entry);
          const checkScore = Number(check.score ?? Number.NaN);
          const weight = Number(check.weight ?? Number.NaN);
          const mappedCheck: TraceEvaluationCheckView = {
            name: asString(check.name) ?? "check",
            category: asString(check.category) as TraceEvaluationCheckView["category"],
            status: asString(check.status) as TraceEvaluationCheckView["status"],
            label: (asString(check.label) as TraceEvaluationCheckView["label"]) ?? "unknown",
            score: Number.isFinite(checkScore) ? checkScore : null,
            weight: Number.isFinite(weight) ? weight : undefined,
            critical: Boolean(check.critical),
            available: check.available === undefined ? true : Boolean(check.available),
            reason: asString(check.reason) ?? "",
          };
          return mappedCheck;
        }),
        error: asString(result.error),
      };
    }),
    review,
    promotion: buildPromotionGate({
      status,
      review,
      recommendation,
      criticalFailures,
      confidence: Number.isFinite(confidenceValue) ? confidenceValue : null,
      failed,
    }),
    approvedAt: asString(payload.approved_at),
    approvedBy: asString(payload.approved_by),
  };
}

async function loadRuntimeTraceRows(workspaceId: string, ids?: string[]) {
  const supabase = createVectorBeaAdminClient();
  let query = supabase
    .from("audit_logs")
    .select("id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  if (ids && ids.length > 0) {
    query = query.in("id", ids);
  } else {
    query = query.limit(250);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as AuditLogTraceRow[]).filter(isRuntimeTraceRow);
}

async function findEvaluationRunRow(workspaceId: string, runIdOrRowId: string): Promise<AuditLogTraceRow | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .eq("id", runIdOrRowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as AuditLogTraceRow;

  const { data: candidates, error: candidatesError } = await supabase
    .from("audit_logs")
    .select("id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (candidatesError) throw new Error(candidatesError.message);

  return ((candidates ?? []) as AuditLogTraceRow[]).find((row) => {
    const run = toRunView(row);
    return Boolean(run && run.id === runIdOrRowId);
  }) ?? null;
}

export async function listEvaluationRuns(workspaceId: string): Promise<TraceSetEvaluationRunView[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);

  return ((data ?? []) as AuditLogTraceRow[])
    .map(toRunView)
    .filter((value): value is TraceSetEvaluationRunView => Boolean(value));
}

export async function getEvaluationRun(workspaceId: string, id: string): Promise<TraceSetEvaluationRunView | null> {
  const row = await findEvaluationRunRow(workspaceId, id);
  return row ? toRunView(row) : null;
}

export async function createTraceSetEvaluationRun(args: {
  workspaceId: string;
  sourceTraceIds: string[];
  candidatePromptVersionId: string;
  triggeredBy: string;
}) {
  const supabase = createVectorBeaAdminClient();
  const sourceRows = await loadRuntimeTraceRows(args.workspaceId, args.sourceTraceIds);
  if (sourceRows.length === 0) {
    throw new Error("No runtime traces were found for this evaluation run.");
  }

  const { data: candidate, error: candidateError } = await supabase
    .from("prompt_versions")
    .select("id, prompt_id, version_tag, template_text, parameters, prompts(id, name)")
    .eq("id", args.candidatePromptVersionId)
    .single();
  if (candidateError) throw new Error(candidateError.message);
  const candidateVersion = candidate as PromptVersionRecord;
  const prompt = getPromptRow(candidateVersion);
  const runId = randomUUID();

  const results: TraceSetEvaluationRunView["results"] = [];
  const replayTraceIds: string[] = [];
  const latencyDeltas: number[] = [];
  const tokenDeltas: number[] = [];
  const confidences: number[] = [];
  const observabilityLevels: Array<string | null> = [];
  let outputChanged = 0;
  let latencyImproved = 0;
  let latencyRegressed = 0;
  let unavailableObservability = 0;
  let criticalFailures = 0;
  let succeeded = 0;
  let failed = 0;
  const scores: number[] = [];

  for (const sourceRow of sourceRows) {
    const sourceMetadata = normalizeTraceMetadataV1(sourceRow.metadata ?? {});
    const requestInput = asRecord(sourceMetadata.request?.input);
    const promptVariables = {
      ...asRecord(sourceMetadata.prompt?.variables),
      ...asRecord(asRecord(sourceMetadata.custom).variables),
      ...asRecord(requestInput.variables),
    };
    const inputText =
      asString(requestInput.text) ??
      asString(asRecord(sourceMetadata.custom).userInput) ??
      "";

    if (!inputText && Object.keys(promptVariables).length === 0) {
      failed += 1;
      results.push({
        sourceTraceId: sourceRow.id,
        replayTraceId: null,
        score: null,
        label: "fail",
        status: "error",
        latencyDeltaMs: null,
        tokenDelta: null,
        confidence: null,
        recommendation: "blocked",
        criticalFailures: 1,
        observabilityNote: "Replay input metadata missing",
        replayMode: null,
        checks: [
          {
            name: "replay_completed",
            category: "reliability",
            status: "fail",
            label: "fail",
            score: 0,
            weight: 1,
            critical: true,
            available: true,
            reason: "Trace metadata lacked replayable input",
          },
        ],
        error: "Replay input metadata was missing for this trace.",
      });
      continue;
    }

    const renderedPrompt = renderTemplate(candidateVersion.template_text ?? "", promptVariables);
    const execution = await executeResolvedPrompt({
      workspaceId: args.workspaceId,
      promptVersionId: candidateVersion.id,
      promptName: prompt?.name ?? sourceRow.prompt_name ?? "unknown-prompt",
      versionTag: candidateVersion.version_tag,
      templateText: candidateVersion.template_text ?? "",
      variables: promptVariables,
      inputText,
      renderedPrompt,
      sourceMetadata,
      replayOf: sourceRow.id,
      triggeredBy: args.triggeredBy,
    });

    const sourceDetail = mapAuditRowToTraceDetail(sourceRow, {
      promptTemplateText: candidateVersion.template_text,
      promptParameters: candidateVersion.parameters,
      promptName: prompt?.name ?? sourceRow.prompt_name,
      promptVersionTag: sourceRow.version_tag,
    });

    const replayMetadata = {
      ...execution.metadata,
      evaluation: undefined,
      tags: {
        ...(execution.metadata.tags ?? {}),
        replay_of: sourceRow.id,
        evaluation_run_id: runId,
        candidate_prompt_version_id: candidateVersion.id,
      },
      custom: {
        ...(execution.metadata.custom ?? {}),
        replay: {
          ...(asRecord(execution.metadata.custom?.replay)),
          evaluation_run_id: runId,
          candidate_prompt_version_id: candidateVersion.id,
        },
      },
    };

    const { data: insertedReplay, error: replayInsertError } = await supabase
      .from("audit_logs")
      .insert({
        workspace_id: args.workspaceId,
        prompt_version_id: candidateVersion.id,
        prompt_name: prompt?.name ?? sourceRow.prompt_name ?? "",
        version_tag: candidateVersion.version_tag,
        proxy_latency_ms: execution.proxyLatencyMs,
        llm_latency_ms: execution.llmLatencyMs,
        token_count: execution.tokenCount,
        metadata: replayMetadata,
      })
      .select("id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
      .single();

    if (replayInsertError) throw new Error(replayInsertError.message);

    const replayRow = insertedReplay as AuditLogTraceRow;
    const replayDetail = mapAuditRowToTraceDetail(replayRow, {
      promptTemplateText: candidateVersion.template_text,
      promptParameters: candidateVersion.parameters,
      promptName: prompt?.name ?? sourceRow.prompt_name,
      promptVersionTag: candidateVersion.version_tag,
    });
    const evaluation = evaluateTraceReplay(sourceDetail, replayDetail);
    const replayMode = asString(normalizeTraceMetadataV1(replayRow.metadata ?? {}).tags?.replay_mode) as "simulated" | "live" | null;

    const metadataWithEvaluation = {
      ...(replayRow.metadata ?? {}),
      evaluation: toMetadataEvaluation(evaluation),
    };
    const { error: evaluationUpdateError } = await supabase
      .from("audit_logs")
      .update({ metadata: metadataWithEvaluation })
      .eq("workspace_id", args.workspaceId)
      .eq("id", replayRow.id);
    if (evaluationUpdateError) throw new Error(evaluationUpdateError.message);

    replayTraceIds.push(replayRow.id);
    if (replayDetail.status === "success") succeeded += 1; else failed += 1;
    if (typeof evaluation.score === "number") scores.push(evaluation.score);
    if (typeof evaluation.confidence === "number") confidences.push(evaluation.confidence);
    if (typeof evaluation.criticalFailures === "number") criticalFailures += evaluation.criticalFailures;
    observabilityLevels.push(replayDetail.executorObservability);
    const latencyDelta = replayDetail.durationMs - sourceDetail.durationMs;
    const leftTokens = sourceDetail.tokensIn + sourceDetail.tokensOut;
    const rightTokens = replayDetail.tokensIn + replayDetail.tokensOut;
    const tokenDelta = leftTokens > 0 && rightTokens > 0 ? rightTokens - leftTokens : null;
    if (latencyDelta < 0) latencyImproved += 1;
    if (latencyDelta > 0) latencyRegressed += 1;
    if ((sourceDetail.outputs.finalDelivered || "").trim() !== (replayDetail.outputs.finalDelivered || "").trim()) outputChanged += 1;
    if (replayDetail.executorObservability !== "full") unavailableObservability += 1;
    latencyDeltas.push(latencyDelta);
    if (tokenDelta !== null) tokenDeltas.push(tokenDelta);

    results.push({
      sourceTraceId: sourceRow.id,
      replayTraceId: replayRow.id,
      score: evaluation.score,
      label: evaluation.label,
      status: replayDetail.status,
      latencyDeltaMs: latencyDelta,
      tokenDelta,
      confidence: evaluation.confidence ?? null,
      recommendation: evaluation.recommendation === "ready"
        ? "ready_for_rollout"
        : evaluation.recommendation === "regression"
          ? "regression_detected"
          : evaluation.recommendation === "blocked"
            ? "blocked"
            : evaluation.recommendation === "inconclusive"
              ? "inconclusive"
              : "needs_review",
      criticalFailures: evaluation.criticalFailures ?? 0,
      observabilityNote: evaluation.observabilityNote ?? null,
      replayMode,
      checks: evaluation.checks,
      error: null,
    });
  }

  const aggregateScore = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
  const aggregateConfidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : null;
  const observabilityLevel = aggregateObservability(observabilityLevels);
  const recommendation =
    criticalFailures > 0 || failed > 0
      ? "blocked"
      : aggregateScore === null
        ? "inconclusive"
        : aggregateScore >= 0.78 && (aggregateConfidence ?? 0) >= 0.7
          ? "ready_for_rollout"
          : aggregateScore <= 0.45 || latencyRegressed > latencyImproved
            ? "regression_detected"
            : aggregateConfidence !== null && aggregateConfidence < 0.6
              ? "ready_with_caution"
              : "needs_review";
  const recommendationReasons: string[] = [];
  if (criticalFailures > 0) recommendationReasons.push("Critical checks failed on one or more traces");
  if (failed > 0) recommendationReasons.push("One or more replay traces failed");
  if (observabilityLevel !== "full") recommendationReasons.push("Executor observability is partial; some checks are unavailable");
  if (recommendation === "regression_detected") recommendationReasons.push("Latency or quality regressed in this run");
  if (recommendation === "ready_for_rollout") recommendationReasons.push("No critical failures and score threshold passed");

  const evaluationMetadata = buildTraceMetadataV1({
    metadata: {
      custom: {
        action: "evaluation_run",
        evaluation_run: {
          id: runId,
          status: "completed",
          prompt_name: prompt?.name ?? "unknown-prompt",
          candidate_prompt_version_id: candidateVersion.id,
          candidate_version_tag: candidateVersion.version_tag,
          source_trace_ids: sourceRows.map((row) => row.id),
          replay_trace_ids: replayTraceIds,
          aggregate: {
            total: results.length,
            succeeded,
            failed,
            output_changed: outputChanged,
            latency_improved: latencyImproved,
            latency_regressed: latencyRegressed,
            unavailable_observability: unavailableObservability,
            average_latency_delta_ms: latencyDeltas.length ? latencyDeltas.reduce((sum, value) => sum + value, 0) / latencyDeltas.length : null,
            average_token_delta: tokenDeltas.length ? tokenDeltas.reduce((sum, value) => sum + value, 0) / tokenDeltas.length : null,
            score: aggregateScore,
            confidence: aggregateConfidence,
            critical_failures: criticalFailures,
            observability_level: observabilityLevel,
            recommendation,
            reasons: recommendationReasons,
          },
          review: defaultReview(),
          results: results.map((result) => ({
            source_trace_id: result.sourceTraceId,
            replay_trace_id: result.replayTraceId,
            score: result.score,
            label: result.label,
            status: result.status,
            latency_delta_ms: result.latencyDeltaMs,
            token_delta: result.tokenDelta,
            confidence: result.confidence ?? null,
            recommendation: result.recommendation ?? "needs_review",
            critical_failures: result.criticalFailures ?? 0,
            observability_note: result.observabilityNote ?? null,
            replay_mode: result.replayMode ?? null,
            checks: (result.checks ?? []).map((check) => ({
              name: check.name,
              category: check.category,
              status: check.status,
              label: check.label,
              score: check.score,
              weight: check.weight,
              critical: check.critical,
              available: check.available,
              reason: check.reason,
            })),
            error: result.error ?? null,
          })),
        },
      },
    },
    useType: "audit",
    workspaceId: args.workspaceId,
    promptVersionId: candidateVersion.id,
    promptName: prompt?.name ?? "unknown-prompt",
    versionTag: candidateVersion.version_tag,
    proxyLatencyMs: 0,
    llmLatencyMs: 0,
    tokenCount: 0,
  });

  const { data: insertedRun, error: runInsertError } = await supabase
    .from("audit_logs")
    .insert({
      workspace_id: args.workspaceId,
      prompt_version_id: candidateVersion.id,
      prompt_name: prompt?.name ?? "unknown-prompt",
      version_tag: candidateVersion.version_tag,
      proxy_latency_ms: 0,
      llm_latency_ms: 0,
      token_count: 0,
      metadata: evaluationMetadata,
    })
    .select("id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
    .single();

  if (runInsertError) throw new Error(runInsertError.message);
  const view = toRunView(insertedRun as AuditLogTraceRow);
  if (!view) throw new Error("Evaluation run could not be materialized.");
  return view;
}

export async function approveEvaluationRun(args: {
  workspaceId: string;
  evaluationRunId: string;
  approvedBy: string;
}) {
  const supabase = createVectorBeaAdminClient();
  const row = await findEvaluationRunRow(args.workspaceId, args.evaluationRunId);
  if (!row) throw new Error("Evaluation run not found");
  const normalized = normalizeTraceMetadataV1(row.metadata ?? {});
  const runPayload = asRecord(asRecord(normalized.custom).evaluation_run);
  const aggregate = asRecord(runPayload.aggregate);
  const review = asRecord(runPayload.review);
  const reviewStatus = asString(review.status) ?? "pending_review";
  const recommendation = asString(aggregate.recommendation) ?? "needs_review";
  const failed = Number(aggregate.failed ?? 0);
  const criticalFailures = Number(aggregate.critical_failures ?? 0);

  const blockingReasons: string[] = [];
  if (reviewStatus !== "approved") blockingReasons.push("Human review must be approved before promotion.");
  if (criticalFailures > 0) blockingReasons.push("Critical evaluation checks are failing.");
  if (failed > 0) blockingReasons.push("Some replay traces failed execution.");
  if (recommendation === "blocked" || recommendation === "regression_detected") {
    blockingReasons.push("Evaluation recommendation indicates regression risk.");
  }
  if (blockingReasons.length > 0) {
    throw new Error(`Promotion blocked: ${blockingReasons.join(" ")}`);
  }

  const candidatePromptVersionId = asString(runPayload.candidate_prompt_version_id) ?? row.prompt_version_id;
  if (!candidatePromptVersionId) throw new Error("Evaluation run is missing candidate prompt version.");

  const { data: promptVersion, error: promptVersionError } = await supabase
    .from("prompt_versions")
    .select("id, prompt_id")
    .eq("id", candidatePromptVersionId)
    .single();
  if (promptVersionError) throw new Error(promptVersionError.message);

  await supabase
    .from("prompt_versions")
    .update({ is_published: false })
    .eq("prompt_id", promptVersion.prompt_id);

  const { error: publishError } = await supabase
    .from("prompt_versions")
    .update({ is_published: true })
    .eq("id", candidatePromptVersionId);
  if (publishError) throw new Error(publishError.message);

  const updatedMetadata = {
    ...normalized,
    custom: {
      ...(normalized.custom ?? {}),
      action: "evaluation_approval",
      evaluation_run: {
        ...runPayload,
        status: "approved",
        review: {
          ...review,
          status: "approved",
          decision: "approve",
          reviewer_id: args.approvedBy,
          reviewed_at: new Date().toISOString(),
          reviewer_note: asString(review.reviewer_note) ?? asString(review.reviewerNote) ?? "Approved for rollout",
        },
        approved_at: new Date().toISOString(),
        approved_by: args.approvedBy,
      },
    },
  };

  const { error: updateError } = await supabase
    .from("audit_logs")
    .update({ metadata: updatedMetadata })
    .eq("workspace_id", args.workspaceId)
    .eq("id", row.id);
  if (updateError) throw new Error(updateError.message);

  const promotionAudit = buildTraceMetadataV1({
    metadata: {
      custom: {
        action: "promote_candidate_version",
        evaluation_run: {
          id: args.evaluationRunId,
          candidate_prompt_version_id: candidatePromptVersionId,
          approved_by: args.approvedBy,
          approved_at: new Date().toISOString(),
        },
      },
    },
    useType: "audit",
    workspaceId: args.workspaceId,
    promptVersionId: candidatePromptVersionId,
    promptName: row.prompt_name,
    versionTag: row.version_tag,
    proxyLatencyMs: 0,
    llmLatencyMs: 0,
    tokenCount: 0,
  });

  await supabase.from("audit_logs").insert({
    workspace_id: args.workspaceId,
    prompt_version_id: candidatePromptVersionId,
    prompt_name: row.prompt_name,
    version_tag: row.version_tag,
    proxy_latency_ms: 0,
    llm_latency_ms: 0,
    token_count: 0,
    metadata: promotionAudit,
  });

  return getEvaluationRun(args.workspaceId, args.evaluationRunId);
}

export async function reviewEvaluationRun(args: {
  workspaceId: string;
  evaluationRunId: string;
  reviewerId: string;
  status: TraceSetEvaluationRunView["review"]["status"];
  decision: TraceSetEvaluationRunView["review"]["decision"];
  note?: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const row = await findEvaluationRunRow(args.workspaceId, args.evaluationRunId);
  if (!row) throw new Error("Evaluation run not found");
  const normalized = normalizeTraceMetadataV1(row.metadata ?? {});
  const runPayload = asRecord(asRecord(normalized.custom).evaluation_run);
  if (!runPayload.id) throw new Error("Evaluation run payload is missing.");

  const updatedRunPayload = {
    ...runPayload,
    review: {
      ...asRecord(runPayload.review),
      status: args.status,
      decision: args.decision,
      reviewer_id: args.reviewerId,
      reviewer_note: args.note ?? null,
      reviewed_at: new Date().toISOString(),
    },
  };

  const nextMetadata = {
    ...normalized,
    custom: {
      ...(normalized.custom ?? {}),
      action: "evaluation_review",
      evaluation_run: updatedRunPayload,
    },
  };

  const { error: updateError } = await supabase
    .from("audit_logs")
    .update({ metadata: nextMetadata })
    .eq("workspace_id", args.workspaceId)
    .eq("id", row.id);
  if (updateError) throw new Error(updateError.message);

  return getEvaluationRun(args.workspaceId, args.evaluationRunId);
}

export async function listRuntimeTraceCandidates(workspaceId: string) {
  return loadRuntimeTraceRows(workspaceId);
}
