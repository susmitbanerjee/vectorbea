import "server-only";

import type {
  ReliabilityRule,
  ReliabilityRuleType,
  ReliabilityRiskLevel,
  ReliabilityRuleResult,
  ReliabilityCheckReport,
  WorkflowTrace,
} from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

// ─── Row types ────────────────────────────────────────────────────────────────

type RuleRow = {
  id: string;
  workspace_id: string;
  capability_id: string | null;
  capability_version_id: string | null;
  name: string;
  description: string | null;
  rule_type: string;
  severity: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ResultRow = {
  id: string;
  workspace_id: string;
  rule_id: string;
  workflow_trace_id: string | null;
  evaluation_run_id: string | null;
  status: string;
  passed: boolean;
  severity: string;
  message: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapRule(row: RuleRow): ReliabilityRule {
  const rule: ReliabilityRule = {
    id: row.id,
    workspaceId: row.workspace_id,
    capabilityId: row.capability_id,
    capabilityVersionId: row.capability_version_id,
    name: row.name,
    description: row.description,
    ruleType: row.rule_type as ReliabilityRuleType,
    severity: row.severity as ReliabilityRiskLevel,
    enabled: row.enabled,
    config: row.config ?? {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  rule.plainEnglish = ruleToPlainEnglish(rule);
  return rule;
}

function mapResult(row: ResultRow, rule?: ReliabilityRule): ReliabilityRuleResult {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ruleId: row.rule_id,
    workflowTraceId: row.workflow_trace_id,
    evaluationRunId: row.evaluation_run_id,
    status: row.status as ReliabilityRuleResult["status"],
    passed: row.passed,
    severity: row.severity as ReliabilityRiskLevel,
    message: row.message,
    details: row.details ?? {},
    createdAt: row.created_at,
    rule,
  };
}

// ─── Plain English descriptions ───────────────────────────────────────────────

export function ruleToPlainEnglish(rule: ReliabilityRule): string {
  const c = rule.config;
  switch (rule.ruleType) {
    case "tool_sequence": {
      const target = String(c.target_tool ?? "?");
      const before = String(c.required_before ?? "?");
      return `${target} cannot run unless ${before} was called earlier in the workflow`;
    }
    case "tool_required":
      return `Workflow must call ${String(c.required_tool ?? "?")}`;
    case "tool_forbidden":
      return `Workflow must not call ${String(c.forbidden_tool ?? "?")}`;
    case "argument_validation": {
      const tool = String(c.tool ?? "?");
      const arg  = String(c.argument ?? "?");
      const op   = String(c.operator ?? "==");
      const ref  = c.compare_to_result_field ? `result.${String(c.compare_to_result_field)}` : String(c.value ?? "?");
      return `${tool}.${arg} must be ${op} ${ref}`;
    }
    case "cost_threshold":
      return `Total workflow cost must be ≤ $${String(c.max_cost ?? "?")}`;
    case "latency_threshold":
      return `Workflow must complete within ${String(c.max_latency_ms ?? "?")}ms`;
    case "max_tool_calls": {
      const tool = String(c.tool ?? "any tool");
      const max  = String(c.max_calls ?? "?");
      return `${tool} must not be called more than ${max} time${Number(max) === 1 ? "" : "s"}`;
    }
    case "output_contains":
      return `Final output must contain "${String(c.text ?? "?")}"`;
    case "output_not_contains":
      return `Final output must not contain "${String(c.text ?? "?")}"`;
    case "regex_check":
      return `Output must match pattern: ${String(c.pattern ?? "?")}`;
    case "pii_detection":
      return "Output must not contain personally identifiable information";
    case "human_handoff_required":
      return `Workflow must trigger human handoff in ${String(c.condition ?? "all cases")}`;
    case "schema_validation":
      return `Output must conform to the defined JSON schema`;
    case "tool_result_condition": {
      const tool   = String(c.tool ?? "?");
      const field  = String(c.result_field ?? "?");
      const op     = String(c.operator ?? "==");
      const val    = String(c.value ?? "?");
      return `${tool} result.${field} must be ${op} ${val}`;
    }
    case "final_action_condition":
      return `Final action must be ${String(c.expected_action ?? "?")}`;
    case "business_policy":
      return String(c.description ?? rule.name);
    default:
      return rule.name;
  }
}

// ─── Rule CRUD ────────────────────────────────────────────────────────────────

export async function listRules(
  workspaceId: string,
  opts?: { capabilityId?: string },
): Promise<ReliabilityRule[]> {
  const supabase = createVectorBeaAdminClient();
  let q = supabase
    .from("reliability_rules")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts?.capabilityId) q = q.eq("capability_id", opts.capabilityId);
  const { data, error } = await q;
  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapRule(row as RuleRow));
}

export async function getRule(workspaceId: string, ruleId: string): Promise<ReliabilityRule | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("reliability_rules")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", ruleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRule(data as RuleRow) : null;
}

export async function createRule(args: {
  workspaceId: string;
  capabilityId?: string | null;
  capabilityVersionId?: string | null;
  name: string;
  description?: string | null;
  ruleType: ReliabilityRuleType;
  severity: ReliabilityRiskLevel;
  enabled?: boolean;
  config: Record<string, unknown>;
  createdBy: string;
}): Promise<ReliabilityRule> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("reliability_rules")
    .insert({
      workspace_id: args.workspaceId,
      capability_id: args.capabilityId ?? null,
      capability_version_id: args.capabilityVersionId ?? null,
      name: args.name,
      description: args.description ?? null,
      rule_type: args.ruleType,
      severity: args.severity,
      enabled: args.enabled ?? true,
      config: args.config,
      created_by: args.createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapRule(data as RuleRow);
}

export async function updateRule(
  workspaceId: string,
  ruleId: string,
  patch: Partial<{
    name: string;
    description: string | null;
    severity: ReliabilityRiskLevel;
    enabled: boolean;
    config: Record<string, unknown>;
  }>,
): Promise<ReliabilityRule> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("reliability_rules")
    .update(patch)
    .eq("workspace_id", workspaceId)
    .eq("id", ruleId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapRule(data as RuleRow);
}

export async function deleteRule(workspaceId: string, ruleId: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("reliability_rules")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", ruleId);
  if (error) throw new Error(error.message);
}

// ─── Deterministic Rule Engine ────────────────────────────────────────────────

function getStepsByTool(trace: WorkflowTrace, toolName: string) {
  return (trace.steps ?? []).filter((s) => s.toolName === toolName);
}

function evaluateRule(rule: ReliabilityRule, trace: WorkflowTrace): { passed: boolean; message: string; details: Record<string, unknown> } {
  const steps  = trace.steps ?? [];
  const c      = rule.config;

  try {
    switch (rule.ruleType) {
      case "tool_required": {
        const required = String(c.required_tool ?? "");
        const called   = steps.some((s) => s.toolName === required);
        return {
          passed: called,
          message: called ? `Required tool ${required} was called` : `Required tool ${required} was not called`,
          details: { required_tool: required, called },
        };
      }

      case "tool_forbidden": {
        const forbidden = String(c.forbidden_tool ?? "");
        const called    = steps.some((s) => s.toolName === forbidden);
        return {
          passed: !called,
          message: !called ? `Forbidden tool ${forbidden} was not called` : `Forbidden tool ${forbidden} was called`,
          details: { forbidden_tool: forbidden, called },
        };
      }

      case "tool_sequence": {
        const target = String(c.target_tool ?? "");
        const before = String(c.required_before ?? "");
        const targetIdx = steps.findIndex((s) => s.toolName === target);
        const beforeIdx = steps.findIndex((s) => s.toolName === before);

        if (targetIdx === -1) {
          return { passed: true, message: `Target tool ${target} was not called — rule does not apply`, details: { skipped: true } };
        }
        const passed = beforeIdx !== -1 && beforeIdx < targetIdx;
        return {
          passed,
          message: passed
            ? `${before} correctly called before ${target}`
            : `${target} was called without ${before} being called first`,
          details: { target_tool: target, required_before: before, target_step_index: targetIdx, before_step_index: beforeIdx },
        };
      }

      case "cost_threshold": {
        const maxCost    = Number(c.max_cost ?? 0);
        const actualCost = trace.totalCostEstimate ?? 0;
        const passed     = actualCost <= maxCost;
        return {
          passed,
          message: passed ? `Cost $${actualCost.toFixed(6)} is within limit $${maxCost}` : `Cost $${actualCost.toFixed(6)} exceeds limit $${maxCost}`,
          details: { actual_cost: actualCost, max_cost: maxCost },
        };
      }

      case "latency_threshold": {
        const maxMs    = Number(c.max_latency_ms ?? 0);
        const actualMs = trace.totalLatencyMs ?? 0;
        const passed   = actualMs <= maxMs;
        return {
          passed,
          message: passed ? `Latency ${actualMs}ms is within limit ${maxMs}ms` : `Latency ${actualMs}ms exceeds limit ${maxMs}ms`,
          details: { actual_latency_ms: actualMs, max_latency_ms: maxMs },
        };
      }

      case "max_tool_calls": {
        const toolName = String(c.tool ?? "");
        const maxCalls = Number(c.max_calls ?? 1);
        const actualCalls = toolName ? getStepsByTool(trace, toolName).length : steps.length;
        const passed   = actualCalls <= maxCalls;
        return {
          passed,
          message: passed ? `${toolName || "Tool"} called ${actualCalls} time(s), within limit of ${maxCalls}` : `${toolName || "Tool"} called ${actualCalls} time(s), exceeds limit of ${maxCalls}`,
          details: { tool: toolName, actual_calls: actualCalls, max_calls: maxCalls },
        };
      }

      case "output_contains": {
        const text     = String(c.text ?? "");
        const output   = trace.finalResponse ?? "";
        const passed   = output.includes(text);
        return {
          passed,
          message: passed ? `Output contains required text` : `Output does not contain required text: "${text}"`,
          details: { required_text: text, output_length: output.length },
        };
      }

      case "output_not_contains": {
        const text   = String(c.text ?? "");
        const output = trace.finalResponse ?? "";
        const passed = !output.includes(text);
        return {
          passed,
          message: passed ? `Output does not contain forbidden text` : `Output contains forbidden text: "${text}"`,
          details: { forbidden_text: text, output_length: output.length },
        };
      }

      case "regex_check": {
        const pattern = String(c.pattern ?? "");
        const flags   = String(c.flags ?? "i");
        const output  = trace.finalResponse ?? "";
        let passed = false;
        try {
          const re = new RegExp(pattern, flags);
          passed = re.test(output);
        } catch {
          return { passed: false, message: `Invalid regex pattern: ${pattern}`, details: { pattern } };
        }
        return {
          passed,
          message: passed ? `Output matches required pattern` : `Output does not match required pattern: ${pattern}`,
          details: { pattern, output_length: output.length },
        };
      }

      case "final_action_condition": {
        const expected = String(c.expected_action ?? "");
        const actual   = trace.finalAction ?? "";
        const passed   = actual === expected;
        return {
          passed,
          message: passed ? `Final action is correct: ${expected}` : `Expected final action "${expected}", got "${actual}"`,
          details: { expected_action: expected, actual_action: actual },
        };
      }

      case "argument_validation": {
        const toolName = String(c.tool ?? "");
        const argName  = String(c.argument ?? "");
        const operator = String(c.operator ?? "==");
        const toolStep = steps.find((s) => s.toolName === toolName);
        if (!toolStep) {
          return { passed: true, message: `Tool ${toolName} was not called — skipping argument validation`, details: { skipped: true } };
        }
        const argValue = (toolStep.toolArguments ?? {})[argName];
        let compareValue: unknown = c.value;
        if (c.compare_to_result_field) {
          const prevStep = steps.filter((s) => s.stepIndex < toolStep.stepIndex).pop();
          compareValue = prevStep ? (prevStep.toolResult ?? {})[String(c.compare_to_result_field)] : undefined;
        }
        const passed = compareValues(argValue, operator, compareValue);
        return {
          passed,
          message: passed ? `${toolName}.${argName} passes validation` : `${toolName}.${argName} (${String(argValue)}) fails: not ${operator} ${String(compareValue)}`,
          details: { tool: toolName, argument: argName, actual_value: argValue, compare_value: compareValue, operator },
        };
      }

      case "tool_result_condition": {
        const toolName  = String(c.tool ?? "");
        const field     = String(c.result_field ?? "");
        const operator  = String(c.operator ?? "==");
        const expected  = c.value;
        const toolStep  = steps.find((s) => s.toolName === toolName);
        if (!toolStep) {
          return { passed: true, message: `Tool ${toolName} was not called — skipping result check`, details: { skipped: true } };
        }
        const actual = (toolStep.toolResult ?? {})[field];
        const passed = compareValues(actual, operator, expected);
        return {
          passed,
          message: passed ? `${toolName} result.${field} passes condition` : `${toolName} result.${field} (${String(actual)}) fails: not ${operator} ${String(expected)}`,
          details: { tool: toolName, field, actual_value: actual, expected_value: expected, operator },
        };
      }

      case "human_handoff_required": {
        const hasHandoff = steps.some((s) => s.stepType === "human_handoff");
        return {
          passed: hasHandoff,
          message: hasHandoff ? `Human handoff step found` : `No human handoff step found`,
          details: { has_handoff: hasHandoff },
        };
      }

      case "pii_detection": {
        const output = trace.finalResponse ?? "";
        const piiPatterns = [
          /\b\d{3}-\d{2}-\d{4}\b/,          // SSN
          /\b\d{16}\b/,                       // Credit card (basic)
          /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email
          /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // Phone
        ];
        const violations = piiPatterns.filter((re) => re.test(output)).map((re) => re.source);
        const passed = violations.length === 0;
        return {
          passed,
          message: passed ? `No PII patterns detected in output` : `Potential PII detected in output`,
          details: { violations_found: violations.length, patterns: violations },
        };
      }

      // For business_policy and schema_validation, do a basic check
      case "business_policy":
      case "schema_validation":
        return { passed: true, message: `Rule type ${rule.ruleType} requires external evaluation — skipped`, details: { skipped: true } };

      default:
        return { passed: true, message: `Unknown rule type — skipped`, details: { skipped: true } };
    }
  } catch (err) {
    return {
      passed: false,
      message: `Rule evaluation error: ${err instanceof Error ? err.message : String(err)}`,
      details: { error: String(err) },
    };
  }
}

function compareValues(a: unknown, operator: string, b: unknown): boolean {
  const na = Number(a); const nb = Number(b);
  switch (operator) {
    case "==":  case "=":  return a === b || String(a) === String(b);
    case "!=":  case "<>": return a !== b && String(a) !== String(b);
    case "<":   return !isNaN(na) && !isNaN(nb) ? na < nb : String(a) < String(b);
    case "<=":  return !isNaN(na) && !isNaN(nb) ? na <= nb : String(a) <= String(b);
    case ">":   return !isNaN(na) && !isNaN(nb) ? na > nb : String(a) > String(b);
    case ">=":  return !isNaN(na) && !isNaN(nb) ? na >= nb : String(a) >= String(b);
    default:    return false;
  }
}

// ─── Run checks ───────────────────────────────────────────────────────────────

export async function runReliabilityChecks(args: {
  workspaceId: string;
  capabilityId?: string | null;
  workflowTrace: WorkflowTrace;
  ruleIds?: string[];
}): Promise<ReliabilityCheckReport> {
  const supabase = createVectorBeaAdminClient();
  const startedAt = new Date().toISOString();

  // Load rules
  let rules = await listRules(args.workspaceId, { capabilityId: args.capabilityId ?? undefined });
  rules = rules.filter((r) => r.enabled);
  if (args.ruleIds && args.ruleIds.length > 0) {
    const ruleSet = new Set(args.ruleIds);
    rules = rules.filter((r) => ruleSet.has(r.id));
  }

  // Evaluate each rule
  const results: ReliabilityRuleResult[] = [];
  const resultInserts: Array<Record<string, unknown>> = [];

  for (const rule of rules) {
    const evaluation = evaluateRule(rule, args.workflowTrace);
    const status: ReliabilityRuleResult["status"] = evaluation.passed ? "passed" : "failed";
    const result: ReliabilityRuleResult = {
      id: "", // filled after insert
      workspaceId: args.workspaceId,
      ruleId: rule.id,
      workflowTraceId: args.workflowTrace.id,
      evaluationRunId: null,
      status,
      passed: evaluation.passed,
      severity: rule.severity,
      message: evaluation.message,
      details: evaluation.details,
      createdAt: startedAt,
      rule,
    };
    results.push(result);
    resultInserts.push({
      workspace_id: args.workspaceId,
      rule_id: rule.id,
      workflow_trace_id: args.workflowTrace.id,
      status,
      passed: evaluation.passed,
      severity: rule.severity,
      message: evaluation.message,
      details: evaluation.details,
    });
  }

  // Persist results
  if (resultInserts.length > 0) {
    const { data: inserted } = await supabase
      .from("reliability_rule_results")
      .insert(resultInserts)
      .select("id, rule_id");
    if (inserted) {
      for (const ins of inserted as Array<{ id: string; rule_id: string }>) {
        const r = results.find((res) => res.ruleId === ins.rule_id);
        if (r) r.id = ins.id;
      }
    }
  }

  // Aggregate
  const passed   = results.filter((r) => r.passed);
  const failed   = results.filter((r) => !r.passed);
  const critical = failed.filter((r) => r.severity === "critical");
  const high     = failed.filter((r) => r.severity === "high");
  const skipped  = results.filter((r) => r.status === "skipped");

  let overallStatus: ReliabilityCheckReport["overallStatus"] = "passed";
  if (critical.length > 0) overallStatus = "failed";
  else if (high.length > 0) overallStatus = "needs_review";
  else if (failed.length > 0) overallStatus = "needs_review";

  return {
    runId: args.workflowTrace.id,
    capabilityId: args.capabilityId ?? null,
    workflowTraceId: args.workflowTrace.id,
    overallStatus,
    passedCount: passed.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    criticalFailures: critical,
    highFailures: high,
    allResults: results,
    createdAt: startedAt,
  };
}

// ─── List rule results ────────────────────────────────────────────────────────

export async function listRuleResults(
  workspaceId: string,
  opts: { workflowTraceId?: string; ruleId?: string; limit?: number },
): Promise<ReliabilityRuleResult[]> {
  const supabase = createVectorBeaAdminClient();
  let q = supabase
    .from("reliability_rule_results")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.workflowTraceId) q = q.eq("workflow_trace_id", opts.workflowTraceId);
  if (opts.ruleId) q = q.eq("rule_id", opts.ruleId);
  const { data, error } = await q;
  if (error) {
    if (error.message.includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => mapResult(row as ResultRow));
}
