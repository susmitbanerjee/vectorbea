import "server-only";

import type {
  TraceCompareFieldView,
  TraceCompareResponse,
  TraceDetailView,
  TraceEvaluationCheckView,
  TraceEvaluationLabel,
  TraceEvaluationView,
} from "@/lib/api";

function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function textChanged(left: string | null | undefined, right: string | null | undefined) {
  return normalizeText(left) !== normalizeText(right);
}

function asDisplay(value: string | number | boolean | null | undefined) {
  if (value === undefined) return null;
  return value;
}

function traceTokenTotal(trace: TraceDetailView) {
  const total = trace.tokensIn + trace.tokensOut;
  return total > 0 ? total : null;
}

function scoreToLabel(score: number): TraceEvaluationLabel {
  if (score >= 0.72) return "better";
  if (score <= 0.44) return "worse";
  return "same";
}

function average(scores: number[]) {
  if (scores.length === 0) return null;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function roundScore(value: number) {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function diffField(
  key: string,
  label: string,
  left: string | number | boolean | null | undefined,
  right: string | number | boolean | null | undefined,
  note?: string,
): TraceCompareFieldView {
  const leftValue = asDisplay(left);
  const rightValue = asDisplay(right);
  const numericDelta =
    typeof leftValue === "number" && typeof rightValue === "number" ? rightValue - leftValue : null;
  return {
    key,
    label,
    left: leftValue,
    right: rightValue,
    changed: leftValue !== rightValue,
    delta: numericDelta,
    note,
  };
}

export function evaluateTraceReplay(left: TraceDetailView, right: TraceDetailView): TraceEvaluationView {
  const checks: TraceEvaluationCheckView[] = [];

  const pushCheck = (check: TraceEvaluationCheckView) => checks.push(check);

  const statusScore = right.status === "success" ? 1 : right.status === "warning" || right.status === "partial" ? 0.45 : 0;
  pushCheck({
    name: "execution_success",
    category: "reliability",
    status: right.status === "success" ? "pass" : "fail",
    label: right.status === "success" ? "pass" : "fail",
    score: statusScore,
    weight: 0.22,
    critical: true,
    available: true,
    reason: right.status === "success" ? "Replay completed successfully" : `Replay finished with ${right.status} status`,
  });

  const outputExists = normalizeText(right.outputs.finalDelivered).length > 0;
  const outputDiffers = textChanged(left.outputs.finalDelivered, right.outputs.finalDelivered);
  pushCheck({
    name: "output_present",
    category: "correctness",
    status: outputExists ? "pass" : "fail",
    label: outputExists ? "pass" : "fail",
    score: outputExists ? (outputDiffers ? 0.85 : 0.72) : 0,
    weight: 0.2,
    critical: true,
    available: true,
    reason: outputExists
      ? outputDiffers
        ? "Replay produced a non-empty output and changed behavior from the source trace"
        : "Replay produced a non-empty output that matches the source trace"
      : "Replay did not produce final output",
  });

  const latencyDelta = right.durationMs - left.durationMs;
  const latencyThreshold = Math.max(left.durationMs * 0.05, 25);
  const latencyLabel: TraceEvaluationLabel =
    latencyDelta < -latencyThreshold ? "better" : latencyDelta > latencyThreshold ? "worse" : "same";
  pushCheck({
    name: "latency_regression",
    category: "performance",
    status: latencyLabel === "worse" ? "warning" : "pass",
    label: latencyLabel,
    score: latencyLabel === "better" ? 1 : latencyLabel === "same" ? 0.72 : 0.2,
    weight: 0.16,
    critical: false,
    available: true,
    reason:
      latencyLabel === "better"
        ? `Replay was ${Math.abs(Math.round(latencyDelta))}ms faster`
        : latencyLabel === "worse"
          ? `Replay was ${Math.round(latencyDelta)}ms slower`
          : "Replay latency stayed within the stability band",
  });

  const leftTokens = traceTokenTotal(left);
  const rightTokens = traceTokenTotal(right);
  if (leftTokens !== null && rightTokens !== null) {
    const tokenDelta = rightTokens - leftTokens;
    const tokenThreshold = Math.max(leftTokens * 0.05, 25);
    const tokenLabel: TraceEvaluationLabel =
      tokenDelta < -tokenThreshold ? "better" : tokenDelta > tokenThreshold ? "worse" : "same";
    pushCheck({
      name: "token_regression",
      category: "performance",
      status: tokenLabel === "worse" ? "warning" : "pass",
      label: tokenLabel,
      score: tokenLabel === "better" ? 1 : tokenLabel === "same" ? 0.76 : 0.34,
      weight: 0.1,
      critical: false,
      available: true,
      reason:
        tokenLabel === "better"
          ? `Replay used ${Math.abs(tokenDelta)} fewer tokens`
          : tokenLabel === "worse"
            ? `Replay used ${tokenDelta} more tokens`
            : "Replay token usage stayed close to the source trace",
    });
  } else {
    pushCheck({
      name: "token_regression",
      category: "observability",
      status: "not_applicable",
      label: "unknown",
      score: null,
      weight: 0.1,
      critical: false,
      available: false,
      reason: "Token comparison unavailable because one side has partial observability",
    });
  }

  const hasStructuredOutput =
    right.outputs.parsedJson !== undefined && right.outputs.parsedJson !== null && Object.keys(right.outputs.parsedJson).length > 0;
  pushCheck({
    name: "structured_output_valid",
    category: "structure",
    status: hasStructuredOutput ? "pass" : "not_applicable",
    label: hasStructuredOutput ? "pass" : "unknown",
    score: hasStructuredOutput ? 0.9 : null,
    weight: 0.12,
    critical: true,
    available: hasStructuredOutput,
    reason: hasStructuredOutput
      ? "Replay produced structured output payload"
      : "Structured output not applicable for this trace",
  });

  const observabilityScore =
    right.executorObservability === "full"
      ? 1
      : right.executorObservability === "partial"
        ? 0.65
        : right.executorObservability === "minimal"
          ? 0.5
          : null;
  pushCheck({
    name: "executor_observability",
    category: "executor_context",
    status:
      right.executorObservability === "full"
        ? "pass"
        : right.executorObservability === "unknown"
          ? "not_applicable"
          : "warning",
    label:
      right.executorObservability === "full"
        ? "pass"
        : right.executorObservability === "unknown"
          ? "unknown"
          : "same",
    score: observabilityScore,
    weight: 0.2,
    critical: false,
    available: observabilityScore !== null,
    reason:
      right.executorObservability === "unknown"
        ? "Executor observability was not reported"
        : `Replay executed via ${right.executorType} with ${right.executorObservability} observability`,
  });

  const scoreParts = checks.filter((check) => check.available && typeof check.score === "number" && typeof check.weight === "number");
  const weightedNumerator = scoreParts.reduce((sum, check) => sum + (check.score as number) * (check.weight as number), 0);
  const weightedDenominator = scoreParts.reduce((sum, check) => sum + (check.weight as number), 0);
  const score = weightedDenominator > 0 ? roundScore(weightedNumerator / weightedDenominator) : average(checks.flatMap((check) => (typeof check.score === "number" ? [check.score] : [])));
  const criticalFailures = checks.filter((check) => check.critical && check.status === "fail").length;
  const configuredWeight = checks.reduce((sum, check) => sum + (typeof check.weight === "number" ? check.weight : 0), 0);
  const observedWeight = scoreParts.reduce((sum, check) => sum + (check.weight as number), 0);
  const confidence = configuredWeight > 0 ? roundScore(observedWeight / configuredWeight) : null;

  const recommendation =
    criticalFailures > 0
      ? "blocked"
      : score === null
        ? "inconclusive"
        : score >= 0.78 && (confidence ?? 0) >= 0.7
          ? "ready"
          : score <= 0.45
            ? "regression"
            : "needs_review";

  const label: TraceEvaluationLabel =
    criticalFailures > 0
      ? "fail"
      : score === null
        ? "unknown"
        : score >= 0.72
          ? "pass"
          : scoreToLabel(score);

  const observabilityNote =
    right.executorObservability === "full"
      ? "Full execution observability available"
      : right.executorObservability === "partial"
        ? "Partial enterprise gateway observability; token/cost checks may be limited"
        : right.executorObservability === "minimal"
          ? "Minimal downstream observability from executor"
          : "Observability level unavailable from executor";

  return {
    score,
    label,
    recommendation,
    confidence,
    criticalFailures,
    observabilityNote,
    comparedAgainstTraceId: left.id,
    evaluationMode: "replay_compare",
    checks,
  };
}

export function buildTraceComparison(left: TraceDetailView, right: TraceDetailView): TraceCompareResponse {
  const leftTokens = traceTokenTotal(left);
  const rightTokens = traceTokenTotal(right);
  const outputChanged = textChanged(left.outputs.finalDelivered, right.outputs.finalDelivered);
  const promptVersionChanged = left.promptVersion !== right.promptVersion;
  const executorChanged =
    left.executorType !== right.executorType ||
    left.executorName !== right.executorName ||
    left.executorOwnership !== right.executorOwnership;
  const observabilityChanged = left.executorObservability !== right.executorObservability;
  const statusChanged = left.status !== right.status;
  const costDelta =
    left.totalCostUsd > 0 || right.totalCostUsd > 0 ? right.totalCostUsd - left.totalCostUsd : null;

  const fields: TraceCompareFieldView[] = [
    diffField("status", "Status", left.status, right.status),
    diffField("duration", "Total latency", left.durationMs, right.durationMs),
    diffField("tokens", "Tokens", leftTokens, rightTokens, leftTokens === null || rightTokens === null ? "Unavailable on one side" : undefined),
    diffField("cost", "Cost", left.totalCostUsd || null, right.totalCostUsd || null),
    diffField("prompt_version", "Prompt version", left.promptVersion, right.promptVersion),
    diffField("executor_type", "Executor type", left.executorType, right.executorType),
    diffField("executor_name", "Executor name", left.executorName, right.executorName),
    diffField("observability", "Observability", left.executorObservability, right.executorObservability),
    diffField("cache", "Cache", left.cacheStatus, right.cacheStatus),
    diffField("fallback", "Fallback", left.fallbackUsed, right.fallbackUsed),
    diffField("output", "Final output", outputChanged ? "changed" : "same", outputChanged ? "changed" : "same"),
  ];

  const callouts: string[] = [];
  callouts.push(outputChanged ? "Replay output differs from the source trace" : "Replay output matches the source trace");
  callouts.push(promptVersionChanged ? "Prompt version changed between traces" : "Replay used the same prompt version");
  callouts.push(executorChanged ? "Executor path changed between traces" : "Executor path stayed consistent");
  if (observabilityChanged) callouts.push("Executor observability level changed");
  if (right.executorType === "enterprise_gateway" && right.executorObservability !== "full") {
    callouts.push("Enterprise gateway returned partial observability; token or cost comparisons may be limited");
  }

  return {
    left,
    right,
    summary: {
      outputChanged,
      promptVersionChanged,
      executorChanged,
      observabilityChanged,
      statusChanged,
      latencyDeltaMs: right.durationMs - left.durationMs,
      tokenDelta: leftTokens !== null && rightTokens !== null ? rightTokens - leftTokens : null,
      costDeltaUsd: costDelta,
      replayLineage: right.replayOf ?? null,
      evaluation: right.evaluation ?? null,
    },
    fields,
    callouts,
  };
}

export function toMetadataEvaluation(evaluation: TraceEvaluationView) {
  return {
    score: evaluation.score,
    label: evaluation.label,
    recommendation: evaluation.recommendation,
    confidence: evaluation.confidence,
    critical_failures: evaluation.criticalFailures,
    observability_note: evaluation.observabilityNote,
    run_id: evaluation.runId ?? undefined,
    dataset_id: evaluation.datasetId ?? undefined,
    compared_against_trace_id: evaluation.comparedAgainstTraceId ?? undefined,
    evaluation_mode: evaluation.evaluationMode ?? "replay_compare",
    checks: evaluation.checks.map((check) => ({
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
  };
}
