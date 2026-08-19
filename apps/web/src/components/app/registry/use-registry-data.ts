"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import {
  policyForRisk,
  type AgentRecord,
  type AgentType,
  type RegistryStatus,
  type RiskLevel,
  type RiskPolicy,
  type SchemaParameter,
  type ToolRecord,
  type ToolType,
} from "~/lib/registry/model";
import type { Environment } from "~/lib/workflows/model";

const PAGE_SIZE = 100;

export function useAgentsData() {
  const data = useRegistryQueries();
  const rows = React.useMemo(() => {
    const tools = new Map((data.tools.data?.items ?? []).map((tool) => [tool.id, tool]));
    const connections = new Map((data.connections.data?.items ?? []).map((connection) => [connection.id, connection]));
    return (data.agents.data?.items ?? []).map((agent) => toAgentRecord(agent, tools, connections));
  }, [data.agents.data, data.connections.data, data.tools.data]);
  return {
    rows,
    loading: data.agents.isPending || data.tools.isPending || data.connections.isPending,
    error: data.agents.error ?? data.tools.error ?? data.connections.error,
    refetch: async () => { await Promise.all([data.agents.refetch(), data.tools.refetch(), data.connections.refetch()]); },
    scope: data.scope,
  };
}

export function useToolsData() {
  const data = useRegistryQueries();
  const rows = React.useMemo(() => {
    const connections = new Map((data.connections.data?.items ?? []).map((connection) => [connection.id, connection]));
    const agentNames = new Map((data.agents.data?.items ?? []).map((agent) => [agent.id, agent.name]));
    return (data.tools.data?.items ?? []).map((tool) => toToolRecord(tool, connections, agentNames));
  }, [data.agents.data, data.connections.data, data.tools.data]);
  return {
    rows,
    loading: data.tools.isPending || data.agents.isPending || data.connections.isPending,
    error: data.tools.error ?? data.agents.error ?? data.connections.error,
    refetch: async () => { await Promise.all([data.tools.refetch(), data.agents.refetch(), data.connections.refetch()]); },
    scope: data.scope,
  };
}

function useRegistryQueries() {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const keyScope = { workspaceId, environmentId: null };
  const enabled = Boolean(workspaceId);
  const params = { ...scope, page: 1, pageSize: PAGE_SIZE };
  return {
    scope,
    agents: useApiQuery({ queryKey: queryKeys.agents.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.agents.list(params), enabled }),
    tools: useApiQuery({ queryKey: queryKeys.tools.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.tools.list(params), enabled }),
    connections: useApiQuery({ queryKey: queryKeys.connections.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.connections.list(params), enabled }),
  };
}

function toAgentRecord(
  agent: contracts.Agent,
  tools: Map<string, contracts.Tool>,
  connections: Map<string, contracts.Connection>,
): AgentRecord {
  const connection = agent.llmConnectionId ? connections.get(agent.llmConnectionId) : undefined;
  const grants = agent.allowedToolIds.flatMap((id) => {
    const tool = tools.get(id);
    if (!tool) return [];
    return [{
      tool: tool.name,
      risk: toRisk(tool.riskLevel),
      environments: ["production", "staging", "development"] as Environment[],
      requiresApproval: tool.requiresApproval,
    }];
  });
  const timeoutMs = numberFrom(agent.timeoutPolicy, "timeoutMs") ?? 60_000;
  return {
    id: agent.id,
    name: agent.name,
    description: agent.role ?? firstLine(agent.instructions) ?? "No description yet.",
    model: agent.modelName ?? "Not configured",
    provider: providerFor(agent.modelName, connection?.provider),
    type: toAgentType(agent.type),
    status: toStatus(agent.status),
    grants,
    runs30d: 0,
    successRate: 0,
    avgTokens: 0,
    avgCostUsd: 0,
    p95DurationMs: 0,
    lastUsedAt: agent.updatedAt,
    version: 1,
    owner: "Workspace",
    byokConnection: connection?.name ?? null,
    systemPrompt: agent.instructions ?? "",
    temperature: agent.temperature ?? 0,
    maxTokens: agent.maxTokens ?? 0,
    outputSchema: Object.keys(agent.outputSchema).length > 0 ? "strict" : "none",
    guardrails: {
      maxIterations: agent.maxIterations ?? 0,
      costCeilingUsd: numberFrom(agent.approvalPolicy, "costCeilingUsd") ?? 0,
      timeoutMs,
      contentFilters: stringArray(agent.approvalPolicy.contentFilters),
      forbiddenActions: stringArray(agent.approvalPolicy.forbiddenActions),
    },
    promptVersions: [{ version: 1, at: agent.updatedAt, author: "Workspace", summary: "Current configuration", text: agent.instructions ?? "" }],
    successTrend: [],
    costTrend: [],
    tokenBuckets: [],
    failureReasons: [],
    usedBy: [],
    hasUsageData: false,
    connectionStatus: toHealth(connection?.status),
    connectionLatencyMs: connection?.lastTestLatencyMs ?? null,
  };
}

function toToolRecord(
  tool: contracts.Tool,
  connections: Map<string, contracts.Connection>,
  agentNames: Map<string, string>,
): ToolRecord {
  const connection = tool.connectionId ? connections.get(tool.connectionId) : undefined;
  const risk = toRisk(tool.riskLevel);
  const defaults = policyForRisk(risk);
  const allowedAgents = stringArray(tool.config.allowedAgentIds).map((id) => agentNames.get(id) ?? id);
  const policy: RiskPolicy = {
    ...defaults,
    requiresApprovalGate: tool.requiresApproval,
    allowedAgents,
    allowedEnvironments: environmentArray(tool.config.allowedEnvironments) ?? defaults.allowedEnvironments,
    rateLimitPerMinute: numberFrom(tool.config, "rateLimitPerMinute"),
    auditAlways: tool.config.auditAlways === true || defaults.auditAlways,
  };
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description ?? "No description yet.",
    type: toToolType(tool.type, tool.config),
    risk,
    status: toStatus(tool.status),
    connection: connection?.name ?? null,
    calls30d: 0,
    successRate: 0,
    p95LatencyMs: 0,
    timeoutMs: tool.timeoutMs ?? 0,
    lastError: connection?.lastTestErrorMessageSanitized ?? null,
    owner: "Workspace",
    endpoint: stringFrom(tool.config, "url") ?? stringFrom(tool.config, "endpoint") ?? tool.slug,
    authMethod: connection?.authType ?? "Not configured",
    parameters: schemaParameters(tool.inputSchema),
    outputFields: schemaParameters(tool.outputSchema),
    policy,
    latencyBuckets: [],
    errorBreakdown: [],
    recentFailures: [],
    versions: [{ version: 1, at: tool.updatedAt, author: "Workspace", summary: "Current schema", breaking: false, breakingFields: [] }],
    usedBy: [],
    usedByAgents: [],
    hasUsageData: false,
    connectionStatus: toHealth(connection?.status),
    connectionLatencyMs: connection?.lastTestLatencyMs ?? null,
  };
}

function schemaParameters(schema: Record<string, unknown>): SchemaParameter[] {
  const properties = objectFrom(schema.properties);
  const required = new Set(stringArray(schema.required));
  return Object.entries(properties).map(([name, raw]) => {
    const property = objectFrom(raw);
    return {
      name,
      type: typeof property.type === "string" ? property.type : "any",
      required: required.has(name),
      description: typeof property.description === "string" ? property.description : "",
      ...(property.default === undefined ? {} : { defaultValue: String(property.default) }),
    };
  });
}

function toRisk(value: string): RiskLevel {
  return value === "critical" || value === "high" || value === "medium" ? value : "low";
}
function toStatus(value: string): RegistryStatus {
  return value === "paused" || value === "draft" ? value : "active";
}
function toAgentType(value: string): AgentType {
  if (value === "router") return "router";
  if (value === "supervisor") return "reviewer";
  if (value === "conversational") return "researcher";
  return "task";
}
function toToolType(value: string, config: Record<string, unknown>): ToolType {
  if (value === "database") return config.write === true || config.readOnly === false ? "db-write" : "db-read";
  if (value === "builtin" || value === "code") return "builtin";
  if (value === "custom") return "mcp";
  return "http";
}
function providerFor(model?: string | null, provider?: string): string {
  const value = `${provider ?? ""} ${model ?? ""}`.toLowerCase();
  if (value.includes("anthropic") || value.includes("claude")) return "anthropic";
  if (value.includes("google") || value.includes("gemini")) return "google";
  if (value.includes("azure")) return "azure-openai";
  return "openai";
}
function toHealth(value?: string): string {
  if (value === "healthy" || value === "degraded" || value === "failing") return value;
  if (value === "active" || value === "connected") return "healthy";
  if (value === "error" || value === "failed") return "failing";
  return "unknown";
}
function firstLine(value?: string | null): string | null {
  return value?.split("\n")[0]?.trim().slice(0, 180) || null;
}
function objectFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function environmentArray(value: unknown): Environment[] | null {
  const result = stringArray(value).filter((item): item is Environment => item === "production" || item === "staging" || item === "development");
  return result.length > 0 ? result : null;
}
function numberFrom(value: Record<string, unknown>, key: string): number | null {
  return typeof value[key] === "number" ? value[key] : null;
}
function stringFrom(value: Record<string, unknown>, key: string): string | null {
  return typeof value[key] === "string" ? value[key] : null;
}
