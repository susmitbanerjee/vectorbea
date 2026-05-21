import "server-only";

import { randomUUID } from "crypto";
import type { PromptReleasePolicy, PolicyCheckResult, PolicyViolation } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import type { TraceSetEvaluationRunView } from "@/lib/api";

// ── Row shape ───────────────────────────────────────────────────────────────���─

type PolicyRow = {
  id: string;
  workspace_id: string;
  prompt_id: string;
  min_score: number | null;
  require_critical_pass: boolean;
  max_regression_count: number | null;
  block_on_any_failure: boolean;
  require_json_valid: boolean;
  require_no_safety_failures: boolean;
  max_latency_increase_pct: number | null;
  max_cost_increase_pct: number | null;
  created_at: string;
  updated_at: string;
};

function policyFromRow(row: PolicyRow): PromptReleasePolicy {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    promptId: row.prompt_id,
    minScore: row.min_score ?? null,
    requireCriticalPass: row.require_critical_pass ?? true,
    maxRegressionCount: row.max_regression_count ?? null,
    blockOnAnyFailure: row.block_on_any_failure ?? false,
    requireJsonValid: row.require_json_valid ?? false,
    requireNoSafetyFailures: row.require_no_safety_failures ?? true,
    maxLatencyIncreasePct: row.max_latency_increase_pct ?? null,
    maxCostIncreasePct: row.max_cost_increase_pct ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Default policy (used when none has been explicitly configured) ─────────────

export function defaultPolicy(workspaceId: string, promptId: string): PromptReleasePolicy {
  const now = new Date().toISOString();
  return {
    id: "",
    workspaceId,
    promptId,
    minScore: 0.78,
    requireCriticalPass: true,
    maxRegressionCount: 0,
    blockOnAnyFailure: false,
    requireJsonValid: false,
    requireNoSafetyFailures: true,
    maxLatencyIncreasePct: null,
    maxCostIncreasePct: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ── CRUD ─────────────────────────────────────────────────────────��───────────

export async function getPolicy(
  workspaceId: string,
  promptId: string,
): Promise<PromptReleasePolicy> {
  const supabase = createVectorBeaAdminClient();
  try {
    const { data, error } = await supabase
      .from("prompt_release_policies")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("prompt_id", promptId)
      .maybeSingle();

    if (error && error.message?.includes("does not exist")) {
      // Table not yet migrated — return default
      return defaultPolicy(workspaceId, promptId);
    }
    if (error) throw new Error(error.message);
    if (!data) return defaultPolicy(workspaceId, promptId);
    return policyFromRow(data as PolicyRow);
  } catch {
    return defaultPolicy(workspaceId, promptId);
  }
}

export async function upsertPolicy(args: {
  workspaceId: string;
  promptId: string;
  minScore?: number | null;
  requireCriticalPass?: boolean;
  maxRegressionCount?: number | null;
  blockOnAnyFailure?: boolean;
  requireJsonValid?: boolean;
  requireNoSafetyFailures?: boolean;
  maxLatencyIncreasePct?: number | null;
  maxCostIncreasePct?: number | null;
}): Promise<PromptReleasePolicy> {
  const supabase = createVectorBeaAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("prompt_release_policies")
    .upsert(
      {
        id: randomUUID(),
        workspace_id: args.workspaceId,
        prompt_id: args.promptId,
        min_score: args.minScore ?? 0.78,
        require_critical_pass: args.requireCriticalPass ?? true,
        max_regression_count: args.maxRegressionCount ?? 0,
        block_on_any_failure: args.blockOnAnyFailure ?? false,
        require_json_valid: args.requireJsonValid ?? false,
        require_no_safety_failures: args.requireNoSafetyFailures ?? true,
        max_latency_increase_pct: args.maxLatencyIncreasePct ?? null,
        max_cost_increase_pct: args.maxCostIncreasePct ?? null,
        updated_at: now,
      },
      { onConflict: "prompt_id" },
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return policyFromRow(data as PolicyRow);
}

// ── Policy enforcement against an evaluation run ──────────────────────────────

export function checkPolicyAgainstRun(
  policy: PromptReleasePolicy,
  run: TraceSetEvaluationRunView,
): PolicyCheckResult {
  const violations: PolicyViolation[] = [];

  const agg = run.aggregate;
  const results = run.results;

  // 1. Minimum score
  if (policy.minScore != null && agg.score != null && agg.score < policy.minScore) {
    violations.push({
      code: "SCORE_BELOW_MIN",
      reason: `Evaluation score ${Math.round(agg.score * 100)}% is below the required minimum of ${Math.round(policy.minScore * 100)}%.`,
      severity: "blocking",
    });
  }

  // 2. Critical checks must pass
  if (policy.requireCriticalPass && agg.criticalFailures > 0) {
    violations.push({
      code: "CRITICAL_CHECKS_FAILED",
      reason: `${agg.criticalFailures} critical evaluation check(s) failed. All critical checks must pass before promotion.`,
      severity: "blocking",
    });
  }

  // 3. Regression count
  const regressionItems = results.filter(
    (r) => r.recommendation === "regression_detected" || r.recommendation === "blocked",
  ).length;
  if (
    policy.maxRegressionCount != null &&
    regressionItems > policy.maxRegressionCount
  ) {
    violations.push({
      code: "REGRESSION_LIMIT_EXCEEDED",
      reason: `${regressionItems} regression item(s) detected — exceeds the maximum of ${policy.maxRegressionCount} allowed.`,
      severity: "blocking",
    });
  }

  // 4. Block on any failure
  if (policy.blockOnAnyFailure && agg.failed > 0) {
    violations.push({
      code: "ANY_FAILURE_POLICY",
      reason: `${agg.failed} item(s) failed execution. Policy requires zero failures before promotion.`,
      severity: "blocking",
    });
  }

  // 5. Safety failures
  if (policy.requireNoSafetyFailures) {
    const safetyFails = results.filter((r) =>
      (r.checks ?? []).some(
        (c) => c.category === "safety" && (c.status === "fail" || c.status === "warning"),
      ),
    ).length;
    if (safetyFails > 0) {
      violations.push({
        code: "SAFETY_CHECK_FAILED",
        reason: `${safetyFails} item(s) failed safety checks. Policy requires no safety failures.`,
        severity: "blocking",
      });
    }
  }

  // 6. Latency increase
  if (
    policy.maxLatencyIncreasePct != null &&
    agg.averageLatencyDeltaMs != null &&
    agg.averageLatencyDeltaMs > 0
  ) {
    // We don't have absolute baseline latency, so we flag a warning directionally
    violations.push({
      code: "LATENCY_INCREASE_WARNING",
      reason: `Average latency increased by ${Math.round(agg.averageLatencyDeltaMs)}ms vs baseline. Monitor before full rollout.`,
      severity: "warning",
    });
  }

  // 7. JSON valid (check if structured output check failed)
  if (policy.requireJsonValid) {
    const jsonFails = results.filter((r) =>
      (r.checks ?? []).some(
        (c) =>
          (c.name.includes("json") || c.name.includes("structured")) &&
          c.status === "fail",
      ),
    ).length;
    if (jsonFails > 0) {
      violations.push({
        code: "JSON_VALIDATION_FAILED",
        reason: `${jsonFails} item(s) produced invalid JSON output. Policy requires valid structured output.`,
        severity: "blocking",
      });
    }
  }

  const blocking = violations.filter((v) => v.severity === "blocking");
  return {
    passed: blocking.length === 0,
    violations,
    checkedAt: new Date().toISOString(),
  };
}
