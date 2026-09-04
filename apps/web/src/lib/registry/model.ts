import type { Environment } from "~/lib/workflows/model";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AgentType = "task" | "router" | "reviewer" | "researcher";
export type RegistryStatus = "active" | "paused" | "draft";
export type ToolType = "http" | "db-read" | "db-write" | "builtin" | "mcp";
export const TOOL_TYPE_LABEL: Record<ToolType, string> = {
  http: "HTTP", "db-read": "Database read", "db-write": "Database write", builtin: "Built-in", mcp: "MCP",
};

export interface Reference {
  workflowId: string;
  workflowName: string;
  environment: Environment;
  nodeId: string;
  nodeName: string;
}
export interface ToolGrant { tool: string; risk: RiskLevel; environments: Environment[]; requiresApproval: boolean }
export interface PromptVersion { version: number; at: string; author: string; summary: string; text: string }
export interface Guardrails { maxIterations: number; costCeilingUsd: number; timeoutMs: number; contentFilters: string[]; forbiddenActions: string[] }

export interface AgentRecord {
  id: string; name: string; description: string; model: string; provider: string;
  type: AgentType; status: RegistryStatus; grants: ToolGrant[];
  runs30d: number; successRate: number; avgTokens: number; avgCostUsd: number;
  p95DurationMs: number; lastUsedAt: string; version: number; owner: string;
  byokConnection: string | null; systemPrompt: string; temperature: number; maxTokens: number;
  outputSchema: "strict" | "lenient" | "none"; guardrails: Guardrails; promptVersions: PromptVersion[];
  successTrend: number[]; costTrend: number[]; tokenBuckets: { upper: number; count: number }[];
  failureReasons: { reason: string; count: number }[]; usedBy: Reference[];
  hasUsageData?: boolean; connectionStatus?: string; connectionLatencyMs?: number | null;
}

export interface SchemaParameter {
  name: string; type: string; required: boolean; description: string; defaultValue?: string; validation?: string;
}
export interface RiskPolicy {
  requiresApprovalGate: boolean; allowedEnvironments: Environment[]; allowedAgents: string[];
  rateLimitPerMinute: number | null; auditAlways: boolean;
}
export interface SchemaVersion {
  version: number; at: string; author: string; summary: string; breaking: boolean; breakingFields: string[];
}
export interface ToolRecord {
  id: string; name: string; description: string; type: ToolType; risk: RiskLevel;
  status: RegistryStatus; connection: string | null; calls30d: number; successRate: number;
  p95LatencyMs: number; timeoutMs: number; lastError: string | null; owner: string;
  endpoint: string; authMethod: string; parameters: SchemaParameter[]; outputFields: SchemaParameter[];
  policy: RiskPolicy; latencyBuckets: { upperMs: number; count: number }[];
  errorBreakdown: { klass: string; count: number; share: number }[];
  recentFailures: { runId: string; at: string; message: string }[]; versions: SchemaVersion[];
  usedBy: Reference[]; usedByAgents: string[]; hasUsageData?: boolean;
  connectionStatus?: string; connectionLatencyMs?: number | null;
}

export function policyForRisk(risk: RiskLevel): RiskPolicy {
  switch (risk) {
    case "critical": return { requiresApprovalGate: true, allowedEnvironments: ["staging"], allowedAgents: [], rateLimitPerMinute: 5, auditAlways: true };
    case "high": return { requiresApprovalGate: true, allowedEnvironments: ["production", "staging"], allowedAgents: [], rateLimitPerMinute: 30, auditAlways: true };
    case "medium": return { requiresApprovalGate: false, allowedEnvironments: ["production", "staging", "development"], allowedAgents: [], rateLimitPerMinute: 120, auditAlways: false };
    default: return { requiresApprovalGate: false, allowedEnvironments: ["production", "staging", "development"], allowedAgents: [], rateLimitPerMinute: null, auditAlways: false };
  }
}

export interface PolicyFinding { severity: "error" | "warning"; title: string; detail: string; fix: string }
export function policyFindings(tool: ToolRecord): PolicyFinding[] {
  const expected = policyForRisk(tool.risk);
  const findings: PolicyFinding[] = [];
  if (expected.requiresApprovalGate && !tool.policy.requiresApprovalGate) findings.push({ severity: "error", title: `A ${tool.risk}-risk tool can run without an approval gate`, detail: `${tool.name} is classified ${tool.risk}, which requires a human decision before it executes.`, fix: "Turn the approval requirement back on, or reclassify the tool." });
  const extra = tool.policy.allowedEnvironments.filter((environment) => !expected.allowedEnvironments.includes(environment));
  if (extra.length > 0) findings.push({ severity: "warning", title: `Allowed in ${extra.join(" and ")} beyond its tier`, detail: `The configured environment scope is wider than the ${tool.risk} tier.`, fix: "Narrow the environments, or document the exception." });
  if (expected.auditAlways && !tool.policy.auditAlways) findings.push({ severity: "warning", title: "Audit logging is not forced", detail: `A ${tool.risk}-risk call should always leave an audit record.`, fix: "Enable always-audit for this tool." });
  return findings;
}
export function grantFindings(agent: AgentRecord): PolicyFinding[] {
  return agent.grants.filter((grant) => (grant.risk === "critical" || grant.risk === "high") && !grant.requiresApproval).map((grant) => ({ severity: grant.risk === "critical" ? "error" as const : "warning" as const, title: `${grant.tool} is granted at ${grant.risk} risk with no approval gate`, detail: `${agent.name} may call ${grant.tool} in ${grant.environments.join(", ")} without a human decision.`, fix: "Require approval on this grant, or remove it." }));
}
