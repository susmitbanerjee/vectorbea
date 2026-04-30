import "server-only";

import { randomUUID } from "crypto";

import type { TraceEvaluationCheckView, TraceSetEvaluationRunView } from "@/lib/api";
import { evaluateTraceReplay, toMetadataEvaluation } from "@/lib/server/trace-compare";
import { executeResolvedPrompt } from "@/lib/server/execution";
import { isRuntimeTraceRow, mapAuditRowToTraceDetail, type AuditLogTraceRow } from "@/lib/server/traces";
import { buildTraceMetadataV1, normalizeTraceMetadataV1 } from "@/lib/trace-metadata";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { getEvaluationDataset, listDatasetItems } from "@/lib/server/evaluation-datasets";
import { getFirstEnabledProvider, getProviderConfig, listEnabledProviders } from "@/lib/server/provider-keys";

// ── Multi-provider helper ─────────────────────────────────────────────────────

type ResolvedProviderConfig = {
  providerType: string;
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
  configId: string;
};

/**
 * Resolve an ordered list of provider configs from the selectedModels array.
 * Falls back to the first enabled provider when selectedModels is absent.
 */
async function resolveProviderConfigs(
  workspaceId: string,
  selectedModels?: Array<{ providerType: string; model?: string }>,
): Promise<ResolvedProviderConfig[]> {
  if (!selectedModels || selectedModels.length === 0) {
    const first = await getFirstEnabledProvider(workspaceId);
    if (!first) return [];
    return [{
      providerType: first.config.provider_type,
      apiKey: first.apiKey,
      baseUrl: first.config.base_url,
      model: first.config.default_model,
      configId: first.config.id,
    }];
  }
  const all = await listEnabledProviders(workspaceId);
  const result: ResolvedProviderConfig[] = [];
  for (const sel of selectedModels) {
    const row = all.find((p) => p.provider_type === sel.providerType);
    if (!row) continue; // skip unconfigured providers silently
    // Decrypt key (same logic as provider-keys.ts)
    const encKey = process.env.VECTORBEA_ENCRYPTION_KEY ?? "";
    const data = Buffer.from(row.encrypted_key, "base64");
    let apiKey: string;
    if (encKey) {
      const keyBytes = Buffer.from(encKey.slice(0, 32).padEnd(32, "0"));
      const dec = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i++) dec[i] = data[i] ^ keyBytes[i % keyBytes.length];
      apiKey = dec.toString("utf8");
    } else {
      apiKey = data.toString("utf8");
    }
    result.push({
      providerType: row.provider_type,
      apiKey,
      baseUrl: row.base_url,
      model: sel.model ?? row.default_model,
      configId: row.id,
    });
  }
  return result;
}

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

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function similarityLabel(score: number | null): "high" | "medium" | "low" | "unavailable" {
  if (score === null) return "unavailable";
  if (score >= 0.78) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function confidenceLabel(score: number | null): "high" | "medium" | "low" | "insufficient" {
  if (score === null) return "insufficient";
  if (score >= 0.78) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

type EvaluationStep = NonNullable<TraceSetEvaluationRunView["results"][number]["executionSteps"]>[number];

function completedStep(
  name: string,
  label: string,
  status: EvaluationStep["status"],
  summary: string,
  details?: Record<string, unknown>,
  durationMs = 0,
): EvaluationStep {
  const now = new Date().toISOString();
  return {
    name,
    label,
    status,
    startedAt: now,
    completedAt: now,
    durationMs,
    summary,
    details,
  };
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

async function getUnresolvedFlags(workspaceId: string, traceIds: string[]): Promise<Array<{ traceId: string; reason: string | null; flaggedBy: string; flaggedAt: string }>> {
  if (traceIds.length === 0) return [];
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("trace_issue_flags")
    .select("trace_id, reason, flagged_by, flagged_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "open")
    .in("trace_id", traceIds);
  if (error) {
    // If table doesn't exist yet, return empty (graceful degradation)
    if (error.message?.includes("relation") || error.message?.includes("does not exist")) return [];
    console.warn("[evaluation-runs] flag check failed:", error.message);
    return [];
  }
  return (data ?? []).map(row => ({
    traceId: row.trace_id as string,
    reason: row.reason as string | null,
    flaggedBy: row.flagged_by as string,
    flaggedAt: row.flagged_at as string,
  }));
}

function buildPromotionGate(input: {
  status: TraceSetEvaluationRunView["status"];
  review: TraceSetEvaluationRunView["review"];
  recommendation: TraceSetEvaluationRunView["aggregate"]["recommendation"];
  criticalFailures: number;
  confidence: number | null;
  failed: number;
  unresolvedFlagCount?: number;
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
  if ((input.unresolvedFlagCount ?? 0) > 0) {
    reasons.push(`${input.unresolvedFlagCount} source trace(s) have unresolved issue flags`);
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
  const unresolvedFlagCount = Number(aggregate.unresolved_flag_count ?? 0);
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
    datasetId: asString(payload.dataset_id),
    datasetName: asString(payload.dataset_name),
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
      unresolvedFlagCount,
    },
    results: rawResults.map((entry) => {
      const result = asRecord(entry);
      const confidence = Number(result.confidence ?? Number.NaN);
      const rawChecks = Array.isArray(result.checks) ? result.checks : [];
      return {
        datasetItemId: asString(result.dataset_item_id ?? result.datasetItemId),
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
        inputText: asString(result.input_text ?? result.inputText),
        variables: Object.keys(asRecord(result.variables)).length > 0 ? asRecord(result.variables) : null,
        renderedPrompt: asString(result.rendered_prompt ?? result.renderedPrompt),
        provider: asString(result.provider),
        model: asString(result.model),
        evaluationMode: asString(result.evaluation_mode ?? result.evaluationMode) ?? undefined,
        actualOutput: asString(result.actual_output ?? result.actualOutput),
        expectedOutput: asString(result.expected_output ?? result.expectedOutput),
        referenceOutput: asString(result.reference_output ?? result.referenceOutput),
        similarityScore: asNumber(result.similarity_score ?? result.similarityScore),
        similarityLabel: (asString(result.similarity_label ?? result.similarityLabel) as TraceSetEvaluationRunView["results"][number]["similarityLabel"]) ?? "unavailable",
        similarityReason: asString(result.similarity_reason ?? result.similarityReason),
        confidenceLabel: (asString(result.confidence_label ?? result.confidenceLabel) as TraceSetEvaluationRunView["results"][number]["confidenceLabel"]) ?? undefined,
        confidenceReasons: Array.isArray(result.confidence_reasons)
          ? result.confidence_reasons.map(String)
          : Array.isArray(result.confidenceReasons)
            ? result.confidenceReasons.map(String)
            : [],
        executionSteps: Array.isArray(result.execution_steps)
          ? result.execution_steps.map((step) => {
              const row = asRecord(step);
              return {
                name: asString(row.name) ?? "step",
                label: asString(row.label) ?? "Step",
                status: (asString(row.status) as EvaluationStep["status"]) ?? "skipped",
                startedAt: asString(row.started_at ?? row.startedAt),
                completedAt: asString(row.completed_at ?? row.completedAt),
                durationMs: asNumber(row.duration_ms ?? row.durationMs),
                summary: asString(row.summary) ?? "",
                details: asRecord(row.details),
              };
            })
          : [],
        modelResults: Array.isArray(result.model_results)
          ? result.model_results.map((entry) => {
              const modelResult = asRecord(entry);
              return {
                provider: asString(modelResult.provider) ?? "unknown",
                model: asString(modelResult.model) ?? "unknown",
                score: asNumber(modelResult.score),
                similarityScore: asNumber(modelResult.similarity_score ?? modelResult.similarityScore),
                confidence: asNumber(modelResult.confidence),
                latencyMs: asNumber(modelResult.latency_ms ?? modelResult.latencyMs),
                status: (asString(modelResult.status) as TraceSetEvaluationRunView["results"][number]["status"]) ?? "partial",
                output: asString(modelResult.output),
              };
            })
          : [],
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
      unresolvedFlagCount,
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

  // Load provider config so live replays actually call the LLM
  const firstProvider = await getFirstEnabledProvider(args.workspaceId);
  const providerConfig = firstProvider
    ? {
        providerType: firstProvider.config.provider_type,
        apiKey: firstProvider.apiKey,
        baseUrl: firstProvider.config.base_url,
        model: firstProvider.config.default_model,
        configId: firstProvider.config.id,
      }
    : undefined;

  const sourceRows = await loadRuntimeTraceRows(args.workspaceId, args.sourceTraceIds);
  if (sourceRows.length === 0) {
    throw new Error("No runtime traces were found for this evaluation run.");
  }

  // Check for unresolved flags on source traces
  const sourceTraceIdList = sourceRows.map(r => r.id);
  const unresolvedFlags = await getUnresolvedFlags(args.workspaceId, sourceTraceIdList);

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
    const traceFlag = unresolvedFlags.find(f => f.traceId === sourceRow.id);
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
      providerConfig,
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

    const flagCheck: TraceEvaluationCheckView[] = traceFlag ? [{
      name: "unresolved_trace_flag",
      category: "safety" as TraceEvaluationCheckView["category"],
      status: "fail" as TraceEvaluationCheckView["status"],
      label: "fail" as TraceEvaluationCheckView["label"],
      score: 0,
      weight: 1,
      critical: true,
      available: true,
      reason: `Trace is flagged${traceFlag.reason ? `: ${traceFlag.reason}` : ""}. Flagged by ${traceFlag.flaggedBy}.`,
    }] : [];
    if (flagCheck.length > 0) criticalFailures += 1;

    // Build execution steps for evidence dialog
    const traceExecSteps: TraceSetEvaluationRunView["results"][number]["executionSteps"] = [
      {
        name: "load_trace",
        label: "Load source trace",
        status: "success",
        summary: `Loaded trace ${sourceRow.id.slice(0, 16)}… · ${inputText ? "input present" : "no input text"}`,
        durationMs: null,
      },
      {
        name: "render_prompt",
        label: "Render candidate prompt",
        status: "success",
        summary: `Rendered template with ${Object.keys(promptVariables).length} variable(s)`,
        durationMs: null,
      },
      {
        name: "call_provider",
        label: "Call provider",
        status: execution.status === "success" ? "success" : "error",
        summary: execution.status === "success"
          ? `${execution.provider ?? "provider"} / ${execution.model ?? "unknown"} · ${execution.llmLatencyMs ?? 0}ms`
          : `Provider call failed: ${execution.outputText?.slice(0, 120) ?? "unknown error"}`,
        durationMs: execution.llmLatencyMs ?? null,
      },
      {
        name: "capture_output",
        label: "Capture output",
        status: execution.outputText?.trim() ? "success" : "warning",
        summary: execution.outputText?.trim()
          ? `${execution.outputText.length} chars captured`
          : "Provider returned an empty output",
        durationMs: null,
      },
      {
        name: "compare_outputs",
        label: "Compare vs source trace",
        status: (sourceDetail.outputs.finalDelivered || "").trim() === (execution.outputText || "").trim() ? "success" : "warning",
        summary: (sourceDetail.outputs.finalDelivered || "").trim() === (execution.outputText || "").trim()
          ? "Output matches source trace exactly"
          : "Output differs from source trace",
        durationMs: null,
      },
    ];

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
      criticalFailures: (evaluation.criticalFailures ?? 0) + flagCheck.length,
      observabilityNote: evaluation.observabilityNote ?? null,
      replayMode,
      checks: [...evaluation.checks, ...flagCheck],
      error: null,
      // Evidence fields
      inputText,
      renderedPrompt,
      actualOutput: execution.outputText ?? null,
      expectedOutput: sourceDetail.outputs.finalDelivered ?? null,
      provider: execution.provider ?? null,
      model: execution.model ?? null,
      evaluationMode: "trace_replay",
      executionSteps: traceExecSteps,
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
  if (unresolvedFlags.length > 0) recommendationReasons.push(`${unresolvedFlags.length} source trace(s) have unresolved issue flags`);

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
            unresolved_flag_count: unresolvedFlags.length,
            flagged_trace_ids: unresolvedFlags.map(f => f.traceId),
          },
          review: defaultReview(),
          results: results.map((result) => ({
            dataset_item_id: result.datasetItemId ?? null,
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
            input_text: result.inputText ?? null,
            variables: result.variables ?? null,
            rendered_prompt: result.renderedPrompt ?? null,
            provider: result.provider ?? null,
            model: result.model ?? null,
            evaluation_mode: result.evaluationMode ?? null,
            actual_output: result.actualOutput ?? null,
            expected_output: result.expectedOutput ?? null,
            reference_output: result.referenceOutput ?? null,
            similarity_score: result.similarityScore ?? null,
            similarity_label: result.similarityLabel ?? "unavailable",
            similarity_reason: result.similarityReason ?? null,
            confidence_label: result.confidenceLabel ?? null,
            confidence_reasons: result.confidenceReasons ?? [],
            execution_steps: (result.executionSteps ?? []).map((step) => ({
              name: step.name,
              label: step.label,
              status: step.status,
              started_at: step.startedAt ?? null,
              completed_at: step.completedAt ?? null,
              duration_ms: step.durationMs ?? null,
              summary: step.summary,
              details: step.details ?? {},
            })),
            model_results: (result.modelResults ?? []).map((modelResult) => ({
              provider: modelResult.provider,
              model: modelResult.model,
              score: modelResult.score,
              similarity_score: modelResult.similarityScore,
              confidence: modelResult.confidence,
              latency_ms: modelResult.latencyMs,
              status: modelResult.status,
              output: modelResult.output,
            })),
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

  // Notify on completion
  try {
    const { notifyEvaluationCompleted } = await import("@/lib/server/notifications");
    await notifyEvaluationCompleted({
      workspaceId: args.workspaceId,
      promptName: prompt?.name ?? "unknown-prompt",
      versionTag: candidateVersion.version_tag,
      recommendation,
      score: aggregateScore,
      runId: view.id,
      runType: "trace_set",
      passRate: results.length > 0 ? succeeded / results.length : null,
      totalCount: results.length,
      failedCount: failed,
      needsReviewCount: recommendation === "needs_review" || recommendation === "ready_with_caution" ? results.length - succeeded : 0,
      hardFailureCount: criticalFailures,
      averageConfidence: aggregateConfidence,
      provider: results[0]?.provider ?? null,
      model: results[0]?.model ?? null,
    });
  } catch { /* notification errors must never fail the main flow */ }

  // Populate the human review queue for any low-confidence or hard-failure items
  try {
    const { buildReviewQueueForRun } = await import("@/lib/server/provider-arena-governance");
    await buildReviewQueueForRun({ workspaceId: args.workspaceId, evaluationRunId: view.id });
  } catch { /* review queue population must never fail the main flow */ }

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

  // Check for unresolved flags on source traces
  const sourceTraceIds = Array.isArray(runPayload.source_trace_ids) ? runPayload.source_trace_ids.map(String) : [];
  if (sourceTraceIds.length > 0) {
    const unresolvedFlags = await getUnresolvedFlags(args.workspaceId, sourceTraceIds);
    if (unresolvedFlags.length > 0) {
      blockingReasons.push(`${unresolvedFlags.length} source trace(s) have unresolved issue flags. Resolve all flags before promoting.`);
    }
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

// ── Dataset-based evaluation run ─────────────────────────────────────────────
//
// Supports all four item source_types:
//   manual / imported  → fresh prompt execution, no comparison baseline
//   runtime_trace      → replay against source trace (existing logic)
//   golden_trace       → same as runtime_trace, flagged as golden
//
// For manual/imported items there is no prior output to compare against,
// so checks focus on execution completeness, output length, and absence
// of errors rather than output-diff scoring.

// ── String similarity helpers ────────────────────────────────────────────────

/**
 * Levenshtein distance between two strings (capped at 500 chars each for perf).
 */
function levenshteinDistance(a: string, b: string): number {
  const s1 = a.slice(0, 500);
  const s2 = b.slice(0, 500);
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const curr = s1[i - 1] === s2[j - 1] ? dp[j - 1] : 1 + Math.min(prev, dp[j], dp[j - 1]);
      dp[j - 1] = prev;
      prev = curr;
    }
    dp[n] = prev;
  }
  return dp[n];
}

/**
 * Normalized similarity 0–1 using Levenshtein distance.
 * 1 = identical, 0 = completely different.
 */
function stringSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshteinDistance(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

/**
 * For pipe-delimited structured outputs (e.g. "susmit | deployed | ai proxy | success"),
 * compare field-by-field. Returns ratio of exactly matching fields.
 */
function pipeFieldSimilarity(actual: string, expected: string): number {
  const aFields = actual.split("|").map((f) => f.trim().toLowerCase());
  const eFields = expected.split("|").map((f) => f.trim().toLowerCase());
  const count = Math.max(aFields.length, eFields.length);
  if (count === 0) return 1;
  const matches = aFields.filter((f, i) => f === eFields[i]).length;
  return matches / count;
}

function buildManualItemChecks(
  outputText: string,
  expectedOutput: string | null,
  executionStatus: string,
): TraceEvaluationCheckView[] {
  const checks: TraceEvaluationCheckView[] = [];

  // Check 1 — execution (critical)
  checks.push({
    name: "execution_completed",
    category: "reliability",
    status: executionStatus === "success" ? "pass" : "fail",
    label: executionStatus === "success" ? "pass" : "fail",
    score: executionStatus === "success" ? 1 : 0,
    weight: 1,
    critical: true,
    available: true,
    reason: executionStatus === "success"
      ? "Prompt executed successfully — OpenAI returned a response."
      : "Prompt execution failed — OpenAI returned an error.",
  });

  // Check 2 — non-empty output
  const hasOutput = outputText.trim().length > 0;
  checks.push({
    name: "output_non_empty",
    category: "correctness",
    status: hasOutput ? "pass" : "fail",
    label: hasOutput ? "pass" : "fail",
    score: hasOutput ? 1 : 0,
    weight: 1,
    critical: false,
    available: true,
    reason: hasOutput
      ? "Model produced a non-empty response."
      : "Model returned an empty response.",
  });

  // Check 3 — similarity to expected output (only if expected is provided)
  if (expectedOutput?.trim()) {
    const actual = outputText.trim();
    const expected = expectedOutput.trim();

    // Choose best similarity strategy based on format
    const isPipeDelimited = (s: string) => s.includes("|") && s.split("|").length >= 3;
    let similarity: number;
    let strategy: string;

    if (isPipeDelimited(actual) && isPipeDelimited(expected)) {
      // Structured extraction output — compare field by field
      const fieldSim = pipeFieldSimilarity(actual, expected);
      const strSim = stringSimilarity(actual, expected);
      similarity = Math.max(fieldSim, strSim);
      const fieldCount = expected.split("|").length;
      const matchedFields = Math.round(fieldSim * Math.max(actual.split("|").length, fieldCount));
      strategy = `Field match: ${matchedFields}/${fieldCount} fields correct. String similarity: ${Math.round(strSim * 100)}%.`;
    } else {
      // Free-form output — use normalized Levenshtein similarity
      similarity = stringSimilarity(actual, expected);
      strategy = `String similarity: ${Math.round(similarity * 100)}% (normalized edit distance).`;
    }

    const simPass = similarity >= 0.7;
    const simWarn = similarity >= 0.4 && similarity < 0.7;
    checks.push({
      name: "output_matches_expected",
      category: "correctness",
      status: simPass ? "pass" : simWarn ? "warning" : "fail",
      label: simPass ? "pass" : "fail",
      score: similarity,
      weight: 3,
      critical: false,
      available: true,
      reason: strategy,
    });
  }

  return checks;
}

function computeExpectedSimilarity(actualOutput: string, expectedOutput: string | null) {
  if (!expectedOutput?.trim()) {
    return {
      score: null as number | null,
      label: "unavailable" as const,
      reason: "No expected or reference output was available, so similarity was not calculated.",
    };
  }

  const actual = actualOutput.trim();
  const expected = expectedOutput.trim();
  const isPipeDelimited = (s: string) => s.includes("|") && s.split("|").length >= 3;
  const score = isPipeDelimited(actual) && isPipeDelimited(expected)
    ? Math.max(pipeFieldSimilarity(actual, expected), stringSimilarity(actual, expected))
    : stringSimilarity(actual, expected);
  return {
    score,
    label: similarityLabel(score),
    reason: `Heuristic text similarity is ${Math.round(score * 100)}%. This uses lexical overlap/edit distance and is not an LLM judge.`,
  };
}

function computeEvaluationConfidence(input: {
  executionStatus: string;
  outputText: string;
  similarityScore: number | null;
  expectedOutput: string | null;
  observabilityLevel?: string | null;
}) {
  let score = 0.25;
  const reasons: string[] = [];

  if (input.executionStatus === "success") {
    score += 0.25;
    reasons.push("Provider execution succeeded.");
  } else {
    reasons.push("Provider execution failed or returned partial output.");
  }
  if (input.outputText.trim()) {
    score += 0.15;
    reasons.push("Actual LLM output was captured.");
  }
  if (input.expectedOutput?.trim()) {
    score += 0.2;
    reasons.push("Human-provided expected output was available.");
  } else {
    reasons.push("No expected output was provided, so confidence is lower.");
  }
  if (input.similarityScore !== null) {
    score += 0.15;
    reasons.push("Similarity score was calculated.");
  }
  if (input.observabilityLevel && input.observabilityLevel !== "full") {
    score -= 0.1;
    reasons.push("Executor observability is partial, so token/cost evidence may be unavailable.");
  }

  const normalized = Math.max(0, Math.min(1, score));
  return {
    score: normalized,
    label: confidenceLabel(normalized),
    reasons,
  };
}

export async function createDatasetEvaluationRun(args: {
  workspaceId: string;
  datasetId: string;
  candidatePromptVersionId: string;
  triggeredBy: string;
  /** Optional: run against specific provider/model pairs (multi-provider mode) */
  selectedModels?: Array<{ providerType: string; model?: string }>;
}) {
  const supabase = createVectorBeaAdminClient();

  // Load dataset + items
  const dataset = await getEvaluationDataset(args.workspaceId, args.datasetId);
  if (!dataset) throw new Error("Evaluation dataset not found.");

  const items = await listDatasetItems(args.workspaceId, args.datasetId);
  if (items.length === 0) throw new Error("Dataset has no items. Add test cases before running an evaluation.");

  // Resolve provider configs — supports single or multi-provider mode
  const providerConfigs = await resolveProviderConfigs(args.workspaceId, args.selectedModels);
  if (providerConfigs.length === 0) {
    throw new Error(
      "No enabled provider configuration found for this workspace. " +
      "Go to Settings → Provider settings and add an API key before running evaluations.",
    );
  }
  // Primary config used for single-provider path / aggregate scoring
  const providerConfig = providerConfigs[0];

  // Load candidate prompt version
  const { data: candidate, error: candidateError } = await supabase
    .from("prompt_versions")
    .select("id, prompt_id, version_tag, template_text, parameters, prompts(id, name)")
    .eq("id", args.candidatePromptVersionId)
    .single();
  if (candidateError) throw new Error(candidateError.message);
  const candidateVersion = candidate as PromptVersionRecord;
  const promptRow = getPromptRow(candidateVersion);

  // Cross-prompt guard: dataset.promptId must match the candidate version's prompt
  if (dataset.promptId && candidateVersion.prompt_id && dataset.promptId !== candidateVersion.prompt_id) {
    throw Object.assign(
      new Error(
        "Prompt mismatch: this dataset was created for a different prompt. " +
        "Please select a dataset that belongs to the same prompt as the candidate version.",
      ),
      { code: "PROMPT_DATASET_MISMATCH" },
    );
  }

  const runId = randomUUID();

  const results: TraceSetEvaluationRunView["results"] = [];
  const replayTraceIds: string[] = [];
  const latencyDeltas: number[] = [];
  const tokenDeltas: number[] = [];
  const confidences: number[] = [];
  const observabilityLevels: Array<string | null> = [];
  const sourceTraceIdList: string[] = [];
  let outputChanged = 0;
  let latencyImproved = 0;
  let latencyRegressed = 0;
  let unavailableObservability = 0;
  let criticalFailures = 0;
  let succeeded = 0;
  let failed = 0;
  const scores: number[] = [];

  for (const item of items) {
    const isTraceItem = item.sourceType === "runtime_trace" || item.sourceType === "golden_trace";

    if (isTraceItem && item.traceId) {
      // ── Replay path (same as existing trace-set logic) ──────────────────
      sourceTraceIdList.push(item.traceId);
      const sourceRows = await loadRuntimeTraceRows(args.workspaceId, [item.traceId]);
      if (sourceRows.length === 0) {
        failed += 1;
        results.push({
          sourceTraceId: item.traceId,
          replayTraceId: null,
          score: null,
          label: "fail",
          status: "error",
          latencyDeltaMs: null,
          tokenDelta: null,
          confidence: null,
          recommendation: "blocked",
          criticalFailures: 1,
          observabilityNote: "Source trace not found",
          replayMode: null,
          checks: [{
            name: "replay_completed",
            category: "reliability",
            status: "fail",
            label: "fail",
            score: 0,
            weight: 1,
            critical: true,
            available: true,
            reason: "Source trace not found in audit_logs.",
          }],
          error: "Source trace not found.",
        });
        continue;
      }

      const sourceRow = sourceRows[0];
      const sourceMetadata = normalizeTraceMetadataV1(sourceRow.metadata ?? {});
      const requestInput = asRecord(sourceMetadata.request?.input);
      const promptVariables = {
        ...asRecord(sourceMetadata.prompt?.variables),
        ...asRecord(asRecord(sourceMetadata.custom).variables),
        ...asRecord(requestInput.variables),
      };
      const inputText = asString(requestInput.text) ?? asString(asRecord(sourceMetadata.custom).userInput) ?? "";

      if (!inputText && Object.keys(promptVariables).length === 0) {
        failed += 1;
        results.push({
          sourceTraceId: item.traceId,
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
          checks: [{
            name: "replay_completed",
            category: "reliability",
            status: "fail",
            label: "fail",
            score: 0,
            weight: 1,
            critical: true,
            available: true,
            reason: "Trace metadata lacked replayable input.",
          }],
          error: "Replay input metadata was missing for this trace.",
        });
        continue;
      }

      const renderedPrompt = renderTemplate(candidateVersion.template_text ?? "", promptVariables);
      const execution = await executeResolvedPrompt({
        workspaceId: args.workspaceId,
        promptVersionId: candidateVersion.id,
        promptName: promptRow?.name ?? sourceRow.prompt_name ?? "unknown-prompt",
        versionTag: candidateVersion.version_tag,
        templateText: candidateVersion.template_text ?? "",
        variables: promptVariables,
        inputText,
        renderedPrompt,
        sourceMetadata,
        replayOf: sourceRow.id,
        triggeredBy: args.triggeredBy,
        providerConfig,
      });

      const sourceDetail = mapAuditRowToTraceDetail(sourceRow, {
        promptTemplateText: candidateVersion.template_text,
        promptParameters: candidateVersion.parameters,
        promptName: promptRow?.name ?? sourceRow.prompt_name,
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
          dataset_id: args.datasetId,
          dataset_item_source_type: item.sourceType,
          is_golden: String(item.isGolden || item.sourceType === "golden_trace"),
        },
        custom: {
          ...(execution.metadata.custom ?? {}),
          replay: {
            ...asRecord(execution.metadata.custom?.replay),
            evaluation_run_id: runId,
            candidate_prompt_version_id: candidateVersion.id,
            dataset_id: args.datasetId,
          },
        },
      };

      const { data: insertedReplay, error: replayInsertError } = await supabase
        .from("audit_logs")
        .insert({
          workspace_id: args.workspaceId,
          prompt_version_id: candidateVersion.id,
          prompt_name: promptRow?.name ?? sourceRow.prompt_name ?? "",
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
        promptName: promptRow?.name ?? sourceRow.prompt_name,
        promptVersionTag: candidateVersion.version_tag,
      });
      const evaluation = evaluateTraceReplay(sourceDetail, replayDetail);
      const replayMode = asString(normalizeTraceMetadataV1(replayRow.metadata ?? {}).tags?.replay_mode) as "simulated" | "live" | null;

      const metadataWithEvaluation = {
        ...(replayRow.metadata ?? {}),
        evaluation: toMetadataEvaluation(evaluation),
      };
      await supabase
        .from("audit_logs")
        .update({ metadata: metadataWithEvaluation })
        .eq("workspace_id", args.workspaceId)
        .eq("id", replayRow.id);

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
        sourceTraceId: item.traceId,
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
        referenceOutput: item.referenceOutput ?? null,
        evaluationMode: item.referenceOutput?.trim()
          ? "reference_output"
          : item.sourceType === "golden_trace"
            ? "trace_replay"
            : "trace_replay",
      });
    } else {
      // ── Fresh execution path (manual / imported items) ──────────────────
      const inputText = item.input ?? "";
      if (!inputText.trim()) {
        failed += 1;
        results.push({
          sourceTraceId: item.id,
          replayTraceId: null,
          score: null,
          label: "fail",
          status: "error",
          latencyDeltaMs: null,
          tokenDelta: null,
          confidence: null,
          recommendation: "blocked",
          criticalFailures: 1,
          observabilityNote: null,
          replayMode: null,
          checks: [{
            name: "input_provided",
            category: "reliability",
            status: "fail",
            label: "fail",
            score: 0,
            weight: 1,
            critical: true,
            available: true,
            reason: "Dataset item has no input text.",
          }],
          error: "Dataset item has no input text.",
        });
        continue;
      }

      const metadataVariables = item.metadata && typeof item.metadata === "object"
        ? asRecord(item.metadata)
        : {};
      const variables = { ...metadataVariables, input: inputText };
      const renderedPrompt = renderTemplate(candidateVersion.template_text ?? "", variables);
      const executionSteps: EvaluationStep[] = [
        completedStep("load_dataset_item", "Load dataset item", "success", "Loaded dataset input and expected output.", {
          dataset_item_id: item.id,
          has_expected_output: Boolean(item.expectedOutput?.trim()),
        }),
        completedStep("render_prompt", "Render prompt", "success", "Rendered the candidate prompt with dataset variables.", {
          prompt_version_id: candidateVersion.id,
          variable_keys: Object.keys(variables),
        }),
      ];

      // ── Execute against each selected provider (concurrency: 3) ─────────────
      const CONCURRENCY = 3;
      const providerExecutions: Array<{ cfg: ResolvedProviderConfig; result: Awaited<ReturnType<typeof executeResolvedPrompt>> }> = [];
      for (let pi = 0; pi < providerConfigs.length; pi += CONCURRENCY) {
        const batch = providerConfigs.slice(pi, pi + CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map((cfg) =>
            executeResolvedPrompt({
              workspaceId: args.workspaceId,
              promptVersionId: candidateVersion.id,
              promptName: promptRow?.name ?? dataset.promptName ?? "unknown-prompt",
              versionTag: candidateVersion.version_tag,
              templateText: candidateVersion.template_text ?? "",
              variables,
              inputText,
              renderedPrompt,
              triggeredBy: args.triggeredBy,
              providerConfig: cfg,
            })
          ),
        );
        for (let bi = 0; bi < batch.length; bi++) {
          const r = batchResults[bi];
          if (r.status === "fulfilled") {
            providerExecutions.push({ cfg: batch[bi], result: r.value });
          } else {
            // Provider failed entirely — create a synthetic error result
            providerExecutions.push({
              cfg: batch[bi],
              result: {
                status: "error",
                outputText: null,
                rawOutputText: undefined,
                proxyLatencyMs: 0,
                llmLatencyMs: 0,
                tokenCount: 0,
                provider: batch[bi].providerType,
                model: batch[bi].model ?? undefined,
                errorMessage: r.reason instanceof Error ? r.reason.message : "Provider call failed",
                executor: { type: "unknown", name: batch[bi].providerType, response_observability: "none" },
                metadata: {},
              } as unknown as Awaited<ReturnType<typeof executeResolvedPrompt>>,
            });
          }
        }
      }
      // Primary execution = first successful provider, or first provider if all failed
      const primaryExec = providerExecutions.find((e) => e.result.status === "success") ?? providerExecutions[0];
      const execution = primaryExec.result;

      executionSteps.push(
        completedStep(
          "call_provider",
          providerExecutions.length > 1 ? `Call ${providerExecutions.length} providers` : "Call provider/model",
          execution.status === "success" ? "success" : "error",
          execution.status === "success" ? `${providerExecutions.length} provider call(s) completed.` : "Provider call failed.",
          {
            provider: execution.provider ?? "unknown",
            model: execution.model ?? "unknown",
            multi_provider: providerExecutions.length > 1,
            provider_count: providerExecutions.length,
          },
          execution.llmLatencyMs,
        ),
        completedStep("receive_output", "Receive output", execution.outputText?.trim() ? "success" : "warning", execution.outputText?.trim() ? "Captured LLM output." : "Provider returned an empty output.", {
          output_length: execution.outputText?.length ?? 0,
          token_count: execution.tokenCount,
        }),
      );

      // Store execution as an audit log trace
      const execMetadata = {
        ...execution.metadata,
        tags: {
          ...(execution.metadata.tags ?? {}),
          evaluation_run_id: runId,
          candidate_prompt_version_id: candidateVersion.id,
          dataset_id: args.datasetId,
          dataset_item_id: item.id,
          dataset_item_source_type: item.sourceType,
        },
        custom: {
          ...(execution.metadata.custom ?? {}),
          dataset_eval: {
            evaluation_run_id: runId,
            dataset_id: args.datasetId,
            dataset_item_id: item.id,
            input: inputText,
            expected_output: item.expectedOutput ?? null,
          },
        },
      };

      const { data: insertedExec, error: execInsertError } = await supabase
        .from("audit_logs")
        .insert({
          workspace_id: args.workspaceId,
          prompt_version_id: candidateVersion.id,
          prompt_name: promptRow?.name ?? dataset.promptName ?? "unknown-prompt",
          version_tag: candidateVersion.version_tag,
          proxy_latency_ms: execution.proxyLatencyMs,
          llm_latency_ms: execution.llmLatencyMs,
          token_count: execution.tokenCount,
          metadata: execMetadata,
        })
        .select("id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
        .single();

      if (execInsertError) throw new Error(execInsertError.message);

      const execRow = insertedExec as AuditLogTraceRow;
      replayTraceIds.push(execRow.id);

      // For golden_trace items, prefer referenceOutput (the captured trace output) over expectedOutput
      const isGoldenItem = item.sourceType === "golden_trace";
      const comparisonTarget = isGoldenItem
        ? (item.referenceOutput ?? item.expectedOutput)
        : item.expectedOutput;
      const comparisonMode: string = comparisonTarget?.trim()
        ? (isGoldenItem && item.referenceOutput?.trim() ? "reference_output" : "expected_output")
        : "no_reference";

      const itemChecks = buildManualItemChecks(execution.outputText ?? "", comparisonTarget, execution.status);
      const similarity = computeExpectedSimilarity(execution.outputText ?? "", comparisonTarget);
      const confidence = computeEvaluationConfidence({
        executionStatus: execution.status,
        outputText: execution.outputText ?? "",
        similarityScore: similarity.score,
        expectedOutput: comparisonTarget,
        observabilityLevel: execution.executor.response_observability,
      });
      executionSteps.push(
        completedStep(
          "compare_expected_or_reference",
          "Compare expected/reference",
          comparisonTarget?.trim() ? "success" : "skipped",
          comparisonMode === "reference_output"
            ? "Using the captured golden trace output as the reference for similarity scoring."
            : comparisonMode === "expected_output"
              ? "Using human-provided expected output as the comparison target."
              : "No reference or expected output was provided for this item. Similarity is unavailable.",
          { mode: comparisonMode, has_reference: Boolean(item.referenceOutput?.trim()), has_expected: Boolean(item.expectedOutput?.trim()) },
        ),
        completedStep("calculate_similarity", "Calculate similarity", similarity.score === null ? "skipped" : "success", similarity.reason, {
          similarity_score: similarity.score,
          similarity_label: similarity.label,
        }),
        completedStep("calculate_confidence", "Calculate confidence", "success", `Confidence is ${confidence.label}.`, {
          confidence_score: confidence.score,
          confidence_label: confidence.label,
          reasons: confidence.reasons,
        }),
      );
      const critFails = itemChecks.filter((c) => c.critical && c.status === "fail").length;
      criticalFailures += critFails;

      const weightedSum = itemChecks.reduce((sum, c) => sum + (c.score ?? 0) * (c.weight ?? 1), 0);
      const totalWeight = itemChecks.reduce((sum, c) => sum + (c.weight ?? 1), 0);
      const itemScore = totalWeight > 0 ? weightedSum / totalWeight : null;
      executionSteps.push(
        completedStep("calculate_weighted_score", "Calculate weighted score", "success", `Weighted score is ${itemScore === null ? "unavailable" : `${Math.round(itemScore * 100)}%`}.`, {
          weighted_sum: weightedSum,
          total_weight: totalWeight,
          final_score: itemScore,
        }),
      );
      if (itemScore !== null) scores.push(itemScore);

      if (execution.status === "success") succeeded += 1; else failed += 1;
      // No latency delta for fresh executions (no baseline)
      observabilityLevels.push(execution.executor.response_observability ?? "unknown");

      const itemLabel: TraceSetEvaluationRunView["results"][number]["label"] =
        critFails > 0 ? "fail" : (itemScore ?? 0) >= 0.7 ? "pass" : "fail";
      const recommendation = critFails > 0 ? "blocked" : (itemScore ?? 0) >= 0.7 ? "ready_for_rollout" : "needs_review";
      executionSteps.push(
        completedStep("assign_verdict", "Assign verdict", recommendation === "ready_for_rollout" ? "success" : "warning", `Verdict: ${recommendation.replaceAll("_", " ")}.`, {
          recommendation,
          critical_failures: critFails,
        }),
      );
      confidences.push(confidence.score);
      if (execution.executor.response_observability !== "full") unavailableObservability += 1;

      results.push({
        datasetItemId: item.id,
        sourceTraceId: item.id,
        replayTraceId: execRow.id,
        score: itemScore,
        label: itemLabel,
        status: execution.status === "success" ? "success" : "error",
        latencyDeltaMs: null,
        tokenDelta: null,
        confidence: confidence.score,
        recommendation,
        criticalFailures: critFails,
        observabilityNote: execution.executor.response_observability !== "full" ? "Partial observability: token/cost checks may be unavailable." : null,
        replayMode: "live",
        checks: itemChecks,
        error: execution.status !== "success" ? (execution.outputText ?? "Execution failed") : null,
        inputText,
        variables,
        renderedPrompt,
        provider: execution.provider ?? execution.executor.name ?? null,
        model: execution.model ?? null,
        evaluationMode: comparisonMode as "reference_output" | "expected_output" | "no_reference",
        actualOutput: execution.outputText ?? "",
        expectedOutput: item.expectedOutput ?? null,
        referenceOutput: item.referenceOutput ?? null,
        similarityScore: similarity.score,
        similarityLabel: similarity.label,
        similarityReason: similarity.reason,
        confidenceLabel: confidence.label,
        confidenceReasons: confidence.reasons,
        executionSteps,
        modelResults: providerExecutions.map(({ cfg, result: ex }) => {
          const exSim = computeExpectedSimilarity(ex.outputText ?? "", comparisonTarget);
          const exChecks = buildManualItemChecks(ex.outputText ?? "", comparisonTarget, ex.status);
          const exWeight = exChecks.reduce((s, c) => s + (c.weight ?? 1), 0);
          const exScore = exWeight > 0 ? exChecks.reduce((s, c) => s + (c.score ?? 0) * (c.weight ?? 1), 0) / exWeight : null;
          return {
            provider: ex.provider ?? cfg.providerType,
            model: ex.model ?? cfg.model ?? "unknown",
            score: exScore,
            similarityScore: exSim.score,
            confidence: null,
            latencyMs: ex.llmLatencyMs,
            status: ex.status === "success" ? "success" as const : "error" as const,
            output: ex.outputText ?? "",
            error: ex.status !== "success" ? ((ex as { errorMessage?: string }).errorMessage ?? "Failed") : undefined,
          };
        }),
      });
    }
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const aggregateScore = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
  const aggregateConfidence = confidences.length ? confidences.reduce((s, v) => s + v, 0) / confidences.length : 0.85;
  const observabilityLevel = aggregateObservability(observabilityLevels);

  const recommendation =
    criticalFailures > 0 || failed > 0
      ? "blocked"
      : aggregateScore === null
        ? "inconclusive"
        : aggregateScore >= 0.78
          ? "ready_for_rollout"
          : aggregateScore <= 0.45
            ? "regression_detected"
            : "needs_review";

  const recommendationReasons: string[] = [];
  if (criticalFailures > 0) recommendationReasons.push("Critical checks failed on one or more items");
  if (failed > 0) recommendationReasons.push("One or more items failed execution");
  if (recommendation === "ready_for_rollout") recommendationReasons.push("All items executed successfully and score threshold passed");

  // ── Unresolved flags on source traces ────────────────────────────────────
  const unresolvedFlags = sourceTraceIdList.length > 0
    ? await getUnresolvedFlags(args.workspaceId, sourceTraceIdList)
    : [];
  if (unresolvedFlags.length > 0) {
    recommendationReasons.push(`${unresolvedFlags.length} source trace(s) have unresolved issue flags`);
  }

  const evaluationMetadata = buildTraceMetadataV1({
    metadata: {
      custom: {
        action: "evaluation_run",
        evaluation_run: {
          id: runId,
          status: "completed",
          prompt_name: promptRow?.name ?? dataset.promptName ?? "unknown-prompt",
          candidate_prompt_version_id: candidateVersion.id,
          candidate_version_tag: candidateVersion.version_tag,
          dataset_id: args.datasetId,
          dataset_name: dataset.name,
          evaluation_mode: args.selectedModels && args.selectedModels.length > 1 ? "multi_provider" : "single_provider",
          selected_models: args.selectedModels ?? null,
          source_trace_ids: sourceTraceIdList,
          replay_trace_ids: replayTraceIds,
          aggregate: {
            total: results.length,
            succeeded,
            failed,
            output_changed: outputChanged,
            latency_improved: latencyImproved,
            latency_regressed: latencyRegressed,
            unavailable_observability: unavailableObservability,
            average_latency_delta_ms: latencyDeltas.length ? latencyDeltas.reduce((s, v) => s + v, 0) / latencyDeltas.length : null,
            average_token_delta: tokenDeltas.length ? tokenDeltas.reduce((s, v) => s + v, 0) / tokenDeltas.length : null,
            score: aggregateScore,
            confidence: aggregateConfidence,
            critical_failures: criticalFailures,
            observability_level: observabilityLevel,
            recommendation,
            reasons: recommendationReasons,
            unresolved_flag_count: unresolvedFlags.length,
            flagged_trace_ids: unresolvedFlags.map((f) => f.traceId),
          },
          review: defaultReview(),
          results: results.map((result) => ({
            dataset_item_id: result.datasetItemId ?? null,
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
            input_text: result.inputText ?? null,
            variables: result.variables ?? null,
            rendered_prompt: result.renderedPrompt ?? null,
            provider: result.provider ?? null,
            model: result.model ?? null,
            evaluation_mode: result.evaluationMode ?? null,
            actual_output: result.actualOutput ?? null,
            expected_output: result.expectedOutput ?? null,
            reference_output: result.referenceOutput ?? null,
            similarity_score: result.similarityScore ?? null,
            similarity_label: result.similarityLabel ?? "unavailable",
            similarity_reason: result.similarityReason ?? null,
            confidence_label: result.confidenceLabel ?? null,
            confidence_reasons: result.confidenceReasons ?? [],
            execution_steps: (result.executionSteps ?? []).map((step) => ({
              name: step.name,
              label: step.label,
              status: step.status,
              started_at: step.startedAt ?? null,
              completed_at: step.completedAt ?? null,
              duration_ms: step.durationMs ?? null,
              summary: step.summary,
              details: step.details ?? {},
            })),
            model_results: (result.modelResults ?? []).map((modelResult) => ({
              provider: modelResult.provider,
              model: modelResult.model,
              score: modelResult.score,
              similarity_score: modelResult.similarityScore,
              confidence: modelResult.confidence,
              latency_ms: modelResult.latencyMs,
              status: modelResult.status,
              output: modelResult.output,
            })),
          })),
        },
      },
    },
    useType: "audit",
    workspaceId: args.workspaceId,
    promptVersionId: candidateVersion.id,
    promptName: promptRow?.name ?? dataset.promptName ?? "unknown-prompt",
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
      prompt_name: promptRow?.name ?? dataset.promptName ?? "unknown-prompt",
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
  if (!view) throw new Error("Dataset evaluation run could not be materialized.");

  // Await so notification completes before the serverless function exits
  try {
    const { notifyEvaluationCompleted } = await import("@/lib/server/notifications");
    await notifyEvaluationCompleted({
      workspaceId: args.workspaceId,
      promptName: promptRow?.name ?? dataset.promptName ?? "unknown-prompt",
      versionTag: candidateVersion.version_tag,
      recommendation,
      score: aggregateScore,
      runId: view.id,
      runType: "dataset",
      datasetName: dataset.name,
      passRate: results.length > 0 ? succeeded / results.length : null,
      totalCount: results.length,
      failedCount: failed,
      needsReviewCount: recommendation === "needs_review" || recommendation === "ready_with_caution" ? results.length - succeeded : 0,
      hardFailureCount: criticalFailures,
      averageConfidence: aggregateConfidence,
      provider: results[0]?.provider ?? null,
      model: results[0]?.model ?? null,
    });
  } catch { /* notification errors must never fail the main flow */ }

  // Populate the human review queue for any low-confidence or hard-failure items
  try {
    const { buildReviewQueueForRun } = await import("@/lib/server/provider-arena-governance");
    await buildReviewQueueForRun({ workspaceId: args.workspaceId, evaluationRunId: view.id });
  } catch { /* review queue population must never fail the main flow */ }

  return view;
}
