import "server-only";

import type {
  AutomationROISettings,
  CapabilityCostAnalytics,
  ModelRoutingRecommendation,
  ProviderPricingConfig,
  RoiDashboardData,
  RoiFailureCostAttribution,
  RoiProviderComparison,
  RoiReport,
} from "@/lib/api";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

type TraceAnalyticsRow = {
  id: string;
  workspace_id: string;
  capability_id: string | null;
  capability_version_id: string | null;
  prompt_id: string | null;
  prompt_version_id: string | null;
  provider: string | null;
  model: string | null;
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
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type StepCostRow = {
  workflow_trace_id: string;
  step_type: string;
  step_name: string;
  tool_name: string | null;
  cost_estimate: number | null;
};

type CapabilityRow = {
  id: string;
  name: string;
  type: string;
  business_domain: string;
};

type PricingRow = {
  id: string;
  workspace_id: string | null;
  provider: string;
  model: string;
  input_token_price_per_million: number;
  output_token_price_per_million: number;
  currency: string;
  effective_from: string;
  created_at: string;
  updated_at: string;
};

type RoiSettingsRow = {
  workspace_id: string;
  average_manual_resolution_minutes: number;
  average_agent_operator_hourly_cost: number;
  currency: string;
  created_at: string;
  updated_at: string;
};

type RecommendationRow = {
  id: string;
  workspace_id: string;
  capability_id: string | null;
  recommendation_type: ModelRoutingRecommendation["recommendationType"];
  summary: string;
  evidence: Record<string, unknown> | null;
  estimated_savings: number | null;
  confidence: number | null;
  status: ModelRoutingRecommendation["status"];
  created_at: string;
};

type RoiReportRow = {
  id: string;
  workspace_id: string;
  created_by: string;
  filters: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  created_at: string;
};

type RoiFilters = {
  from?: string | null;
  to?: string | null;
  capabilityId?: string | null;
  capabilityType?: string | null;
  businessDomain?: string | null;
  provider?: string | null;
  model?: string | null;
  environment?: string | null;
};

type EnrichedTrace = TraceAnalyticsRow & {
  capabilityName: string | null;
  capabilityType: string | null;
  businessDomain: string | null;
  estimatedCost: number;
  derivedOutcomeStatus: NonNullable<RoiDashboardData["metrics"]> extends never ? never : string;
  derivedOutcomeReason: string;
  environment: string | null;
};

const DEFAULT_PROVIDER_PRICING: Array<Omit<ProviderPricingConfig, "id" | "workspaceId" | "effectiveFrom" | "createdAt" | "updatedAt">> = [
  { provider: "openai", model: "gpt-4o", inputTokenPricePerMillion: 5, outputTokenPricePerMillion: 15, currency: "USD" },
  { provider: "openai", model: "gpt-4o-mini", inputTokenPricePerMillion: 0.15, outputTokenPricePerMillion: 0.6, currency: "USD" },
  { provider: "anthropic", model: "claude-3-5-sonnet", inputTokenPricePerMillion: 3, outputTokenPricePerMillion: 15, currency: "USD" },
  { provider: "anthropic", model: "claude-3-5-haiku", inputTokenPricePerMillion: 0.8, outputTokenPricePerMillion: 4, currency: "USD" },
  { provider: "google", model: "gemini-2.0-flash", inputTokenPricePerMillion: 0.1, outputTokenPricePerMillion: 0.4, currency: "USD" },
  { provider: "google", model: "gemini-1.5-pro", inputTokenPricePerMillion: 1.25, outputTokenPricePerMillion: 5, currency: "USD" },
  { provider: "qwen", model: "qwen-plus", inputTokenPricePerMillion: 0.4, outputTokenPricePerMillion: 1.2, currency: "USD" },
];

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

function dateKey(iso: string) {
  return iso.slice(0, 10);
}

function mapPricing(row: PricingRow): ProviderPricingConfig {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    provider: row.provider,
    model: row.model,
    inputTokenPricePerMillion: Number(row.input_token_price_per_million ?? 0),
    outputTokenPricePerMillion: Number(row.output_token_price_per_million ?? 0),
    currency: row.currency,
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSettings(row: RoiSettingsRow, workspaceId: string): AutomationROISettings {
  return {
    workspaceId,
    averageManualResolutionMinutes: Number(row.average_manual_resolution_minutes ?? 15),
    averageAgentOperatorHourlyCost: Number(row.average_agent_operator_hourly_cost ?? 20),
    currency: row.currency ?? "USD",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRecommendation(row: RecommendationRow, capabilityName: string | null): ModelRoutingRecommendation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    capabilityId: row.capability_id,
    recommendationType: row.recommendation_type,
    summary: row.summary,
    evidence: row.evidence ?? {},
    estimatedSavings: row.estimated_savings,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
    capabilityName,
  };
}

function inferOutcomeStatus(trace: TraceAnalyticsRow) {
  if (trace.outcome_status) return trace.outcome_status;
  const finalAction = asString(asRecord(trace.metadata).final_action) ?? null;
  if (finalAction?.includes("handoff")) return "human_handoff";
  if (trace.status === "failed") return "failed";
  if (trace.status === "cancelled") return "cancelled";
  if (trace.status === "running") return "partial_success";
  return "success";
}

function inferOutcomeReason(trace: TraceAnalyticsRow) {
  if (trace.outcome_reason) return trace.outcome_reason;
  const metadata = asRecord(trace.metadata);
  const errorReason = asString(metadata.error_reason) ?? asString(metadata.reason);
  if (errorReason) return errorReason;
  if (trace.status === "failed") return "tool_error";
  const outcomeStatus = inferOutcomeStatus(trace);
  if (outcomeStatus === "human_handoff") return "human_review_required";
  return "completed_without_handoff";
}

function inferEnvironment(trace: TraceAnalyticsRow) {
  const metadata = asRecord(trace.metadata);
  return (
    asString(metadata.environment) ??
    asString(asRecord(metadata.custom).environment) ??
    asString(asRecord(asRecord(metadata.custom).trace).environment) ??
    null
  );
}

function estimateCost(trace: TraceAnalyticsRow, pricing: ProviderPricingConfig[]) {
  const existing = asNumber(trace.total_cost_estimate);
  if (existing !== null) return existing;

  const modelCost = asNumber(trace.model_cost);
  const toolCost = asNumber(trace.tool_cost) ?? 0;
  const judgeCost = asNumber(trace.judge_cost) ?? 0;
  const retryCost = asNumber(trace.retry_cost) ?? 0;
  if (modelCost !== null) return round(modelCost + toolCost + judgeCost + retryCost, 6);

  const provider = (trace.provider ?? "").toLowerCase();
  const model = (trace.model ?? "").toLowerCase();
  const match = pricing.find((entry) => entry.provider.toLowerCase() === provider && entry.model.toLowerCase() === model);
  if (!match) return round(toolCost + judgeCost + retryCost, 6);

  const inputTokens = Math.max(trace.total_tokens_input ?? 0, 0);
  const outputTokens = Math.max(trace.total_tokens_output ?? 0, 0);
  const estimatedModelCost =
    (inputTokens / 1_000_000) * match.inputTokenPricePerMillion +
    (outputTokens / 1_000_000) * match.outputTokenPricePerMillion;
  return round(estimatedModelCost + toolCost + judgeCost + retryCost, 6);
}

function recommendFixForReason(reason: string) {
  const normalized = reason.toLowerCase();
  if (normalized.includes("loop")) return "Reduce repeated tool calls";
  if (normalized.includes("invalid")) return "Add argument validation rule";
  if (normalized.includes("timeout")) return "Add timeout fallback";
  if (normalized.includes("human")) return "Add human handoff earlier";
  if (normalized.includes("policy") || normalized.includes("unsafe")) return "Add deterministic precheck";
  return "Review workflow path and lower cost before escalation";
}

async function getCapabilitiesMap(workspaceId: string, capabilityIds: string[]) {
  if (capabilityIds.length === 0) return new Map<string, CapabilityRow>();
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("ai_capabilities")
    .select("id,name,type,business_domain")
    .eq("workspace_id", workspaceId)
    .in("id", capabilityIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [String((row as CapabilityRow).id), row as CapabilityRow]));
}

export async function listProviderPricingConfigs(workspaceId: string): Promise<ProviderPricingConfig[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("provider_pricing_configs")
    .select("*")
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
    .order("effective_from", { ascending: false });
  if (error && !error.message.toLowerCase().includes("does not exist")) {
    throw new Error(error.message);
  }
  const dbEntries = (data ?? []).map((row) => mapPricing(row as PricingRow));
  const byKey = new Map<string, ProviderPricingConfig>();
  for (const entry of dbEntries) {
    byKey.set(`${entry.workspaceId ?? "global"}:${entry.provider.toLowerCase()}:${entry.model.toLowerCase()}`, entry);
  }
  for (const entry of DEFAULT_PROVIDER_PRICING) {
    const key = `global:${entry.provider.toLowerCase()}:${entry.model.toLowerCase()}`;
    if (!Array.from(byKey.values()).some((existing) => existing.workspaceId == null && existing.provider.toLowerCase() === entry.provider.toLowerCase() && existing.model.toLowerCase() === entry.model.toLowerCase())) {
      byKey.set(key, {
        id: key,
        workspaceId: null,
        provider: entry.provider,
        model: entry.model,
        inputTokenPricePerMillion: entry.inputTokenPricePerMillion,
        outputTokenPricePerMillion: entry.outputTokenPricePerMillion,
        currency: entry.currency,
        effectiveFrom: new Date(0).toISOString(),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      });
    }
  }
  return Array.from(byKey.values());
}

export async function getAutomationRoiSettings(workspaceId: string): Promise<AutomationROISettings> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("automation_roi_settings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error && !error.message.toLowerCase().includes("does not exist")) throw new Error(error.message);
  if (!data) {
    return {
      workspaceId,
      averageManualResolutionMinutes: 15,
      averageAgentOperatorHourlyCost: 20,
      currency: "USD",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    };
  }
  return mapSettings(data as RoiSettingsRow, workspaceId);
}

export async function upsertAutomationRoiSettings(args: {
  workspaceId: string;
  averageManualResolutionMinutes: number;
  averageAgentOperatorHourlyCost: number;
  currency: string;
}) {
  await assertFeatureAccess(args.workspaceId, "advanced_roi_reports");
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("automation_roi_settings")
    .upsert({
      workspace_id: args.workspaceId,
      average_manual_resolution_minutes: args.averageManualResolutionMinutes,
      average_agent_operator_hourly_cost: args.averageAgentOperatorHourlyCost,
      currency: args.currency,
    }, { onConflict: "workspace_id" })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapSettings(data as RoiSettingsRow, args.workspaceId);
}

async function loadTraces(workspaceId: string, filters: RoiFilters) {
  const supabase = createVectorBeaAdminClient();
  let query = supabase
    .from("workflow_traces")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (filters.capabilityId) query = query.eq("capability_id", filters.capabilityId);
  if (filters.provider) query = query.eq("provider", filters.provider);
  if (filters.model) query = query.eq("model", filters.model);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  const { data, error } = await query;
  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) return [] as EnrichedTrace[];
    throw new Error(error.message);
  }
  const rows = (data ?? []) as TraceAnalyticsRow[];
  const capabilityMap = await getCapabilitiesMap(workspaceId, rows.map((row) => row.capability_id).filter((value): value is string => Boolean(value)));
  const pricing = await listProviderPricingConfigs(workspaceId);

  return rows
    .map((row) => {
      const capability = row.capability_id ? capabilityMap.get(row.capability_id) ?? null : null;
      return {
        ...row,
        capabilityName: capability?.name ?? null,
        capabilityType: capability?.type ?? null,
        businessDomain: capability?.business_domain ?? null,
        estimatedCost: estimateCost(row, pricing),
        derivedOutcomeStatus: inferOutcomeStatus(row),
        derivedOutcomeReason: inferOutcomeReason(row),
        environment: inferEnvironment(row),
      };
    })
    .filter((row) => !filters.capabilityType || row.capabilityType === filters.capabilityType)
    .filter((row) => !filters.businessDomain || row.businessDomain === filters.businessDomain)
    .filter((row) => !filters.environment || row.environment === filters.environment);
}

function buildProviderComparisons(traces: EnrichedTrace[], settings: AutomationROISettings): RoiProviderComparison[] {
  const valuePerSuccessfulRun = (settings.averageManualResolutionMinutes / 60) * settings.averageAgentOperatorHourlyCost;
  const groups = new Map<string, EnrichedTrace[]>();
  for (const trace of traces) {
    const key = `${trace.provider ?? "unknown"}::${trace.model ?? "unknown"}`;
    groups.set(key, [...(groups.get(key) ?? []), trace]);
  }

  return Array.from(groups.entries()).map(([key, items]) => {
    const [provider, model] = key.split("::");
    const success = items.filter((item) => item.derivedOutcomeStatus === "success");
    const handoffs = items.filter((item) => item.derivedOutcomeStatus === "human_handoff");
    const failures = items.filter((item) => ["failed", "blocked", "timeout"].includes(item.derivedOutcomeStatus));
    const totalCost = items.reduce((sum, item) => sum + item.estimatedCost, 0);
    const successCost = success.reduce((sum, item) => sum + item.estimatedCost, 0);
    const latencies = items.map((item) => item.total_latency_ms ?? 0).filter((value) => value > 0);
    const successRate = items.length > 0 ? success.length / items.length : 0;
    const averageCost = items.length > 0 ? totalCost / items.length : 0;
    const costPerSuccess = success.length > 0 ? successCost / success.length : null;
    const netSavings = success.length * valuePerSuccessfulRun - totalCost;
    let recommendation: string | null = null;
    if (successRate < 0.5 && averageCost > 0) recommendation = "High cost with low success rate";
    else if ((handoffs.length / Math.max(items.length, 1)) > 0.35) recommendation = "Reduces reliability through excess human handoff";
    else if (averageCost < 0.5 * ((costPerSuccess ?? averageCost) || 1)) recommendation = "Candidate for low risk cost routing";
    return {
      provider,
      model,
      runs: items.length,
      successRate: round(successRate * 100, 2),
      humanHandoffRate: round((handoffs.length / Math.max(items.length, 1)) * 100, 2),
      failureRate: round((failures.length / Math.max(items.length, 1)) * 100, 2),
      averageWorkflowCost: round(averageCost, 6),
      costPerSuccessfulWorkflow: costPerSuccess === null ? null : round(costPerSuccess, 6),
      averageLatencyMs: latencies.length > 0 ? round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length, 2) : null,
      p95LatencyMs: latencies.length > 0 ? percentile(latencies, 95) : null,
      estimatedNetSavings: round(netSavings, 2),
      recommendation,
    };
  }).sort((a, b) => (b.successRate - a.successRate) || (a.averageWorkflowCost - b.averageWorkflowCost));
}

function buildFailureCostAttribution(traces: EnrichedTrace[]): RoiFailureCostAttribution[] {
  const groups = new Map<string, EnrichedTrace[]>();
  for (const trace of traces.filter((item) => item.derivedOutcomeStatus !== "success")) {
    const key = `${trace.derivedOutcomeReason}::${trace.capability_id ?? "none"}`;
    groups.set(key, [...(groups.get(key) ?? []), trace]);
  }
  return Array.from(groups.entries()).map(([key, items]) => {
    const [reason] = key.split("::");
    const totalCost = items.reduce((sum, item) => sum + item.estimatedCost, 0);
    return {
      outcomeReason: reason,
      capabilityId: items[0]?.capability_id ?? null,
      capabilityName: items[0]?.capabilityName ?? null,
      runs: items.length,
      totalCost: round(totalCost, 4),
      averageCostPerFailedRun: round(totalCost / Math.max(items.length, 1), 4),
      recommendedFix: recommendFixForReason(reason),
    };
  }).sort((a, b) => b.totalCost - a.totalCost).slice(0, 8);
}

function buildCapabilityAnalytics(traces: EnrichedTrace[], stepRows: StepCostRow[], capabilityId: string): CapabilityCostAnalytics {
  const capabilityTraces = traces.filter((trace) => trace.capability_id === capabilityId);
  const success = capabilityTraces.filter((trace) => trace.derivedOutcomeStatus === "success");
  const failures = capabilityTraces.filter((trace) => ["failed", "blocked", "timeout"].includes(trace.derivedOutcomeStatus));
  const handoffs = capabilityTraces.filter((trace) => trace.derivedOutcomeStatus === "human_handoff");
  const totalCost = capabilityTraces.reduce((sum, trace) => sum + trace.estimatedCost, 0);
  const failureCost = failures.reduce((sum, trace) => sum + trace.estimatedCost, 0);
  const retryCost = capabilityTraces.reduce((sum, trace) => sum + (trace.retry_cost ?? 0), 0);
  const latencies = capabilityTraces.map((trace) => trace.total_latency_ms ?? 0).filter((value) => value > 0);

  const costTrendMap = new Map<string, { totalCost: number; runs: number; successes: number }>();
  const tokenTrendMap = new Map<string, { input: number; output: number }>();
  for (const trace of capabilityTraces) {
    const key = dateKey(trace.created_at);
    const entry = costTrendMap.get(key) ?? { totalCost: 0, runs: 0, successes: 0 };
    entry.totalCost += trace.estimatedCost;
    entry.runs += 1;
    if (trace.derivedOutcomeStatus === "success") entry.successes += 1;
    costTrendMap.set(key, entry);
    const tokenEntry = tokenTrendMap.get(key) ?? { input: 0, output: 0 };
    tokenEntry.input += trace.total_tokens_input ?? 0;
    tokenEntry.output += trace.total_tokens_output ?? 0;
    tokenTrendMap.set(key, tokenEntry);
  }

  const providerGroups = new Map<string, EnrichedTrace[]>();
  for (const trace of capabilityTraces) {
    const key = `${trace.provider ?? "unknown"}::${trace.model ?? "unknown"}`;
    providerGroups.set(key, [...(providerGroups.get(key) ?? []), trace]);
  }

  const stepGroups = new Map<string, { stepType: string; totalCost: number; runs: number; toolName: string | null }>();
  for (const step of stepRows) {
    const key = `${step.step_name}::${step.step_type}::${step.tool_name ?? ""}`;
    const entry = stepGroups.get(key) ?? { stepType: step.step_type, totalCost: 0, runs: 0, toolName: step.tool_name };
    entry.totalCost += step.cost_estimate ?? 0;
    entry.runs += 1;
    stepGroups.set(key, entry);
  }

  const expensiveTool = Array.from(stepGroups.entries())
    .filter(([, entry]) => Boolean(entry.toolName))
    .map(([key, entry]) => ({
      toolName: entry.toolName!,
      totalCost: round(entry.totalCost, 6),
      averageCost: round(entry.totalCost / Math.max(entry.runs, 1), 6),
    }))
    .sort((a, b) => b.totalCost - a.totalCost)[0] ?? null;

  return {
    capabilityId,
    capabilityName: capabilityTraces[0]?.capabilityName ?? null,
    totalRuns: capabilityTraces.length,
    successRate: round((success.length / Math.max(capabilityTraces.length, 1)) * 100, 2),
    humanHandoffRate: round((handoffs.length / Math.max(capabilityTraces.length, 1)) * 100, 2),
    averageCostPerRun: round(totalCost / Math.max(capabilityTraces.length, 1), 6),
    costPerSuccessfulRun: success.length > 0 ? round(success.reduce((sum, trace) => sum + trace.estimatedCost, 0) / success.length, 6) : null,
    costPerFailedRun: failures.length > 0 ? round(failures.reduce((sum, trace) => sum + trace.estimatedCost, 0) / failures.length, 6) : null,
    totalFailureCost: round(failureCost, 6),
    totalRetryCost: round(retryCost, 6),
    averageLatencyMs: latencies.length > 0 ? round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length, 2) : null,
    p95LatencyMs: latencies.length > 0 ? percentile(latencies, 95) : null,
    costTrend: Array.from(costTrendMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
      date,
      totalCost: round(value.totalCost, 6),
      runs: value.runs,
      successRate: round((value.successes / Math.max(value.runs, 1)) * 100, 2),
    })),
    costByProvider: Array.from(providerGroups.entries()).map(([key, items]) => {
      const [provider, model] = key.split("::");
      const total = items.reduce((sum, item) => sum + item.estimatedCost, 0);
      const successes = items.filter((item) => item.derivedOutcomeStatus === "success").length;
      return {
        provider,
        model,
        runs: items.length,
        totalCost: round(total, 6),
        averageCost: round(total / Math.max(items.length, 1), 6),
        successRate: round((successes / Math.max(items.length, 1)) * 100, 2),
      };
    }).sort((a, b) => b.totalCost - a.totalCost),
    stepCostBreakdown: Array.from(stepGroups.entries()).map(([key, entry]) => ({
      stepName: key.split("::")[0] ?? "step",
      stepType: entry.stepType,
      totalCost: round(entry.totalCost, 6),
      averageCost: round(entry.totalCost / Math.max(entry.runs, 1), 6),
      runs: entry.runs,
    })).sort((a, b) => b.totalCost - a.totalCost),
    mostExpensiveTool: expensiveTool,
    tokenUsageTrend: Array.from(tokenTrendMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
      date,
      inputTokens: value.input,
      outputTokens: value.output,
    })),
  };
}

function buildRecommendations(traces: EnrichedTrace[], settings: AutomationROISettings): Array<Omit<ModelRoutingRecommendation, "id" | "createdAt" | "status">> {
  const recommendations: Array<Omit<ModelRoutingRecommendation, "id" | "createdAt" | "status">> = [];
  const providerGroups = buildProviderComparisons(traces, settings);
  const bestBySuccess = [...providerGroups].sort((a, b) => b.successRate - a.successRate || a.averageWorkflowCost - b.averageWorkflowCost)[0] ?? null;
  const cheapestViable = [...providerGroups].find((item) => bestBySuccess && item.successRate >= bestBySuccess.successRate - 5 && item.averageWorkflowCost < bestBySuccess.averageWorkflowCost * 0.8);
  if (bestBySuccess && cheapestViable && cheapestViable.provider !== bestBySuccess.provider) {
    recommendations.push({
      workspaceId: traces[0]?.workspace_id ?? "",
      capabilityId: null,
      recommendationType: "use_cheaper_model_for_low_risk",
      summary: `${cheapestViable.provider} ${cheapestViable.model} can lower workflow cost while staying within acceptable success-rate tolerance`,
      evidence: { current_best: bestBySuccess, cheaper_candidate: cheapestViable },
      estimatedSavings: round((bestBySuccess.averageWorkflowCost - cheapestViable.averageWorkflowCost) * cheapestViable.runs, 2),
      confidence: 0.73,
      capabilityName: null,
    });
  }

  const loops = traces.filter((trace) => trace.derivedOutcomeReason === "agent_loop");
  if (loops.length >= 3) {
    const wasted = loops.reduce((sum, trace) => sum + trace.estimatedCost, 0);
    recommendations.push({
      workspaceId: traces[0]?.workspace_id ?? "",
      capabilityId: loops[0]?.capability_id ?? null,
      recommendationType: "reduce_retries",
      summary: "Agent loops are driving repeated cost without successful completion",
      evidence: { loop_runs: loops.length, wasted_cost: round(wasted, 2) },
      estimatedSavings: round(wasted * 0.5, 2),
      confidence: 0.81,
      capabilityName: loops[0]?.capabilityName ?? null,
    });
  }

  const invalidArguments = traces.filter((trace) => trace.derivedOutcomeReason === "invalid_arguments");
  if (invalidArguments.length >= 2) {
    recommendations.push({
      workspaceId: traces[0]?.workspace_id ?? "",
      capabilityId: invalidArguments[0]?.capability_id ?? null,
      recommendationType: "add_tool_validation",
      summary: "Invalid tool arguments are causing avoidable failed workflow spend",
      evidence: { invalid_argument_runs: invalidArguments.length },
      estimatedSavings: round(invalidArguments.reduce((sum, trace) => sum + trace.estimatedCost, 0) * 0.6, 2),
      confidence: 0.79,
      capabilityName: invalidArguments[0]?.capabilityName ?? null,
    });
  }

  const timeouts = traces.filter((trace) => trace.derivedOutcomeReason === "provider_timeout");
  if (timeouts.length >= 2) {
    recommendations.push({
      workspaceId: traces[0]?.workspace_id ?? "",
      capabilityId: null,
      recommendationType: "change_provider",
      summary: "Provider timeouts are inflating cost and reducing automation success",
      evidence: { timeout_runs: timeouts.length },
      estimatedSavings: round(timeouts.reduce((sum, trace) => sum + trace.estimatedCost, 0) * 0.5, 2),
      confidence: 0.68,
      capabilityName: null,
    });
  }

  const handoffs = traces.filter((trace) => trace.derivedOutcomeStatus === "human_handoff");
  if (handoffs.length >= 3) {
    const avgCostBeforeHandoff = handoffs.reduce((sum, trace) => sum + trace.estimatedCost, 0) / handoffs.length;
    recommendations.push({
      workspaceId: traces[0]?.workspace_id ?? "",
      capabilityId: handoffs[0]?.capability_id ?? null,
      recommendationType: "add_human_handoff_earlier",
      summary: "Expensive workflows are escalating late instead of handing off earlier",
      evidence: { human_handoff_runs: handoffs.length, average_cost_before_handoff: round(avgCostBeforeHandoff, 6) },
      estimatedSavings: round(avgCostBeforeHandoff * handoffs.length * 0.35, 2),
      confidence: 0.72,
      capabilityName: handoffs[0]?.capabilityName ?? null,
    });
  }

  return recommendations.slice(0, 10);
}

async function replaceRecommendations(workspaceId: string, recommendations: Array<Omit<ModelRoutingRecommendation, "id" | "createdAt" | "status">>) {
  const supabase = createVectorBeaAdminClient();
  await supabase
    .from("model_routing_recommendations")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("status", "active");
  if (recommendations.length === 0) return [];
  const { data, error } = await supabase
    .from("model_routing_recommendations")
    .insert(recommendations.map((item) => ({
      workspace_id: workspaceId,
      capability_id: item.capabilityId,
      recommendation_type: item.recommendationType,
      summary: item.summary,
      evidence: item.evidence,
      estimated_savings: item.estimatedSavings,
      confidence: item.confidence,
      status: "active",
    })))
    .select("*");
  if (error && !error.message.toLowerCase().includes("does not exist")) throw new Error(error.message);
  const capabilityMap = await getCapabilitiesMap(workspaceId, recommendations.map((item) => item.capabilityId).filter((value): value is string => Boolean(value)));
  return (data ?? []).map((row) => mapRecommendation(row as RecommendationRow, capabilityMap.get(String((row as RecommendationRow).capability_id ?? ""))?.name ?? null));
}

export async function getRoiDashboardData(workspaceId: string, filters: RoiFilters = {}): Promise<RoiDashboardData> {
  await assertFeatureAccess(workspaceId, "roi_dashboard");
  const [settings, traces] = await Promise.all([
    getAutomationRoiSettings(workspaceId),
    loadTraces(workspaceId, filters),
  ]);
  const successful = traces.filter((trace) => trace.derivedOutcomeStatus === "success");
  const failed = traces.filter((trace) => ["failed", "blocked", "timeout"].includes(trace.derivedOutcomeStatus));
  const handoffs = traces.filter((trace) => trace.derivedOutcomeStatus === "human_handoff");
  const totalCost = traces.reduce((sum, trace) => sum + trace.estimatedCost, 0);
  const successCost = successful.reduce((sum, trace) => sum + trace.estimatedCost, 0);
  const failedCost = failed.reduce((sum, trace) => sum + trace.estimatedCost, 0);
  const latencies = traces.map((trace) => trace.total_latency_ms ?? 0).filter((value) => value > 0);
  const manualHoursSaved = successful.length * (settings.averageManualResolutionMinutes / 60);
  const estimatedLaborSavings = manualHoursSaved * settings.averageAgentOperatorHourlyCost;
  const netSavings = estimatedLaborSavings - totalCost;

  const trendMap = new Map<string, { runs: number; successes: number; totalCost: number; successCost: number }>();
  for (const trace of traces) {
    const key = dateKey(trace.created_at);
    const entry = trendMap.get(key) ?? { runs: 0, successes: 0, totalCost: 0, successCost: 0 };
    entry.runs += 1;
    entry.totalCost += trace.estimatedCost;
    if (trace.derivedOutcomeStatus === "success") {
      entry.successes += 1;
      entry.successCost += trace.estimatedCost;
    }
    trendMap.set(key, entry);
  }

  const capabilityGroups = new Map<string, EnrichedTrace[]>();
  for (const trace of traces) {
    const key = trace.capability_id ?? "unassigned";
    capabilityGroups.set(key, [...(capabilityGroups.get(key) ?? []), trace]);
  }

  const topCapabilities = Array.from(capabilityGroups.entries()).map(([key, items]) => {
    const total = items.reduce((sum, item) => sum + item.estimatedCost, 0);
    const failureCost = items.filter((item) => item.derivedOutcomeStatus !== "success").reduce((sum, item) => sum + item.estimatedCost, 0);
    const successes = items.filter((item) => item.derivedOutcomeStatus === "success").length;
    const handoffCount = items.filter((item) => item.derivedOutcomeStatus === "human_handoff").length;
    return {
      capabilityId: key === "unassigned" ? null : key,
      capabilityName: items[0]?.capabilityName ?? null,
      runs: items.length,
      totalCost: round(total, 4),
      failureCost: round(failureCost, 4),
      successRate: round((successes / Math.max(items.length, 1)) * 100, 2),
      humanHandoffRate: round((handoffCount / Math.max(items.length, 1)) * 100, 2),
    };
  }).sort((a, b) => b.totalCost - a.totalCost).slice(0, 8);

  const providerComparison = buildProviderComparisons(traces, settings);
  const recommendations = await replaceRecommendations(workspaceId, buildRecommendations(traces, settings));

  return {
    workspaceId,
    timeRange: { from: filters.from ?? null, to: filters.to ?? null },
    filters,
    assumptions: settings,
    metrics: {
      totalRuns: traces.length,
      successfulAutomations: successful.length,
      automationSuccessRate: round((successful.length / Math.max(traces.length, 1)) * 100, 2),
      humanHandoffs: handoffs.length,
      humanHandoffRate: round((handoffs.length / Math.max(traces.length, 1)) * 100, 2),
      failedWorkflows: failed.length,
      failureRate: round((failed.length / Math.max(traces.length, 1)) * 100, 2),
      averageCostPerRun: round(totalCost / Math.max(traces.length, 1), 6),
      costPerSuccessfulWorkflow: successful.length > 0 ? round(successCost / successful.length, 6) : null,
      costPerFailedWorkflow: failed.length > 0 ? round(failedCost / failed.length, 6) : null,
      averageLatencyMs: latencies.length > 0 ? round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length, 2) : null,
      p95LatencyMs: latencies.length > 0 ? percentile(latencies, 95) : null,
      manualHoursSaved: round(manualHoursSaved, 2),
      estimatedLaborSavings: round(estimatedLaborSavings, 2),
      netSavings: round(netSavings, 2),
    },
    trends: Array.from(trendMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
      date,
      totalRuns: value.runs,
      successRate: round((value.successes / Math.max(value.runs, 1)) * 100, 2),
      averageCostPerRun: round(value.totalCost / Math.max(value.runs, 1), 6),
      costPerSuccessfulWorkflow: value.successes > 0 ? round(value.successCost / value.successes, 6) : null,
    })),
    topCostLeaks: buildFailureCostAttribution(traces),
    topCapabilities,
    providerComparison,
    recommendations,
  };
}

export async function getCapabilityCostAnalytics(workspaceId: string, capabilityId: string): Promise<CapabilityCostAnalytics> {
  await assertFeatureAccess(workspaceId, "roi_dashboard");
  const traces = await loadTraces(workspaceId, { capabilityId });
  const supabase = createVectorBeaAdminClient();
  const traceIds = traces.map((trace) => trace.id);
  let stepRows: StepCostRow[] = [];
  if (traceIds.length > 0) {
    const { data, error } = await supabase
      .from("workflow_step_traces")
      .select("workflow_trace_id,step_type,step_name,tool_name,cost_estimate")
      .eq("workspace_id", workspaceId)
      .in("workflow_trace_id", traceIds);
    if (error && !error.message.toLowerCase().includes("does not exist")) throw new Error(error.message);
    stepRows = (data ?? []) as StepCostRow[];
  }
  return buildCapabilityAnalytics(traces, stepRows, capabilityId);
}

export async function createRoiReport(args: { workspaceId: string; createdBy: string; filters?: RoiFilters }) {
  await assertFeatureAccess(args.workspaceId, "advanced_roi_reports");
  const dashboard = await getRoiDashboardData(args.workspaceId, args.filters ?? {});
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("roi_reports")
    .insert({
      workspace_id: args.workspaceId,
      created_by: args.createdBy,
      filters: args.filters ?? {},
      summary: dashboard,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: (data as RoiReportRow).id,
    workspaceId: (data as RoiReportRow).workspace_id,
    createdBy: (data as RoiReportRow).created_by,
    filters: (data as RoiReportRow).filters ?? {},
    summary: dashboard,
    createdAt: (data as RoiReportRow).created_at,
  } satisfies RoiReport;
}

export async function getRoiReport(workspaceId: string, reportId: string): Promise<RoiReport | null> {
  await assertFeatureAccess(workspaceId, "advanced_roi_reports");
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("roi_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", reportId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as RoiReportRow;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    filters: row.filters ?? {},
    summary: row.summary as unknown as RoiDashboardData,
    createdAt: row.created_at,
  };
}

export async function listRoiReports(workspaceId: string): Promise<RoiReport[]> {
  await assertFeatureAccess(workspaceId, "advanced_roi_reports");
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("roi_reports")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    if (error.message.toLowerCase().includes("does not exist")) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as RoiReportRow[]).map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    filters: row.filters ?? {},
    summary: row.summary as unknown as RoiDashboardData,
    createdAt: row.created_at,
  }));
}
