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

  const statusScore = right.status === "success" ? 1 : right.status === "warning" || right.status === "partial" ? 0.55 : 0;
  checks.push({
    name: "Replay status",
    label: right.status === "success" ? "pass" : "fail",
    score: statusScore,
    reason:
      right.status === "success"
        ? "Replay completed successfully"
        : `Replay finished with ${right.status} status`,
  });

  const latencyDelta = right.durationMs - left.durationMs;
  const latencyThreshold = Math.max(left.durationMs * 0.05, 25);
  const latencyLabel: TraceEvaluationLabel =
    latencyDelta < -latencyThreshold ? "better" : latencyDelta > latencyThreshold ? "worse" : "same";
  checks.push({
    name: "Latency regression",
    label: latencyLabel,
    score: latencyLabel === "better" ? 1 : latencyLabel === "same" ? 0.72 : 0.25,
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
    checks.push({
      name: "Token usage",
      label: tokenLabel,
      score: tokenLabel === "better" ? 1 : tokenLabel === "same" ? 0.75 : 0.35,
      reason:
        tokenLabel === "better"
          ? `Replay used ${Math.abs(tokenDelta)} fewer tokens`
          : tokenLabel === "worse"
            ? `Replay used ${tokenDelta} more tokens`
            : "Replay token usage stayed close to the source trace",
    });
  } else {
    checks.push({
      name: "Token usage",
      label: "unknown",
      score: null,
      reason: "Token comparison unavailable because one trace has partial observability",
    });
  }

  const outputExists = normalizeText(right.outputs.finalDelivered).length > 0;
  const outputDiffers = textChanged(left.outputs.finalDelivered, right.outputs.finalDelivered);
  checks.push({
    name: "Output availability",
    label: outputExists ? "pass" : "fail",
    score: outputExists ? (outputDiffers ? 0.82 : 0.68) : 0,
    reason: outputExists
      ? outputDiffers
        ? "Replay produced a non-empty output that differs from the source trace"
        : "Replay produced a non-empty output matching the source trace"
      : "Replay did not produce a final output",
  });

  if (right.executorObservability !== "full") {
    checks.push({
      name: "Executor observability",
      label: right.executorObservability === "unknown" ? "unknown" : "same",
      score: right.executorObservability === "unknown" ? null : 0.65,
      reason:
        right.executorObservability === "unknown"
          ? "Executor observability was not reported"
          : `Replay used ${right.executorObservability} observability from ${right.executorType}`,
    });
  }

  const scored = checks.flatMap((check) => (typeof check.score === "number" ? [check.score] : []));
  const score = average(scored);
  const label = score === null ? "unknown" : scoreToLabel(score);

  return {
    score,
    label,
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
    run_id: evaluation.runId ?? undefined,
    dataset_id: evaluation.datasetId ?? undefined,
    compared_against_trace_id: evaluation.comparedAgainstTraceId ?? undefined,
    evaluation_mode: evaluation.evaluationMode ?? "replay_compare",
    checks: evaluation.checks.map((check) => ({
      name: check.name,
      label: check.label,
      score: check.score,
      reason: check.reason,
    })),
  };
}
