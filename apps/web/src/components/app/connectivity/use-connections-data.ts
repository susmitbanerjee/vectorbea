"use client";

import * as React from "react";
import type { contracts } from "@vectorbea/shared";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import type { ConnectionHealth, ConnectionRecord, ConnectionType } from "~/lib/connectivity/model";

const PAGE_SIZE = 100;

export function useConnectionsData() {
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const keyScope = { workspaceId, environmentId: null };
  const params = { ...scope, page: 1, pageSize: PAGE_SIZE };
  const enabled = Boolean(workspaceId);
  const connections = useApiQuery({ queryKey: queryKeys.connections.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.connections.list(params), enabled });
  const tools = useApiQuery({ queryKey: queryKeys.tools.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.tools.list(params), enabled });
  const agents = useApiQuery({ queryKey: queryKeys.agents.list(keyScope, { page: 1, pageSize: PAGE_SIZE }), queryFn: () => api.agents.list(params), enabled });

  const rows = React.useMemo(() => {
    const toolRows = tools.data?.items ?? [];
    const agentRows = agents.data?.items ?? [];
    return (connections.data?.items ?? []).map((connection) => toRecord(connection, toolRows, agentRows));
  }, [agents.data, connections.data, tools.data]);

  return {
    rows,
    scope,
    loading: connections.isPending || tools.isPending || agents.isPending,
    error: connections.error ?? tools.error ?? agents.error,
    refetch: async () => { await Promise.all([connections.refetch(), tools.refetch(), agents.refetch()]); },
  };
}

function toRecord(connection: contracts.Connection, tools: contracts.Tool[], agents: contracts.Agent[]): ConnectionRecord {
  /*
   * BOTH LINKS, not just `connectionId`.
   *
   * A discovered MCP tool's `connectionId` is null — its server lives in
   * `mcpServerConnectionId`, behind its own FK. Matching only the first field
   * made an MCP server's blast radius read "nothing directly depends on this",
   * which is the exact opposite of true: deleting it revokes every tool
   * discovered through it.
   */
  const linkedTools = tools.filter((tool) =>
    tool.connectionId === connection.id || tool.mcpServerConnectionId === connection.id);
  const toolIds = new Set(linkedTools.map((tool) => tool.id));
  const linkedAgents = agents.filter((agent) => agent.llmConnectionId === connection.id || agent.allowedToolIds.some((id) => toolIds.has(id)));
  const status = toHealth(connection.lastTestStatus ?? connection.status);
  const scopes = [...connection.allowedHosts, ...connection.allowedPaths, ...connection.allowedSchemas, ...connection.allowedTables];
  return {
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    type: toType(connection.authType, connection.type),
    status,
    latencyMs: connection.lastTestLatencyMs,
    latencyTrend: connection.lastTestLatencyMs === null ? [] : [connection.lastTestLatencyMs],
    lastCheckedAt: connection.lastTestedAt,
    createdAt: connection.createdAt,
    lastUsedAt: connection.updatedAt,
    expiresAt: stringFrom(connection.config.expiresAt),
    readOnly: connection.config.readOnly === true,
    scopes,
    healthHistory: [status],
    recentErrors: connection.lastTestErrorMessageSanitized ? [{ runId: "", at: connection.lastTestedAt ?? connection.updatedAt, message: connection.lastTestErrorMessageSanitized }] : [],
    audit: [{ at: connection.updatedAt, actor: "workspace", action: "Connection configuration updated" }],
    needsPrivateRunner: connection.networkStatus === "private" || connection.config.privateNetwork === true,
    tools: linkedTools.map((tool) => tool.name),
    agents: linkedAgents.map((agent) => agent.name),
    isMcp: isMcpConnection(connection),
  };
}

/**
 * Whether a connection is an MCP server.
 *
 * Three spellings, all of them real. `tool` is what every MCP connection made
 * before the vocabulary was widened is stored as — `ConnectionTester` has
 * treated the three as one case since it was written — so a check for `mcp`
 * alone would hide the Tools tab from exactly the connections that have tools.
 */
function isMcpConnection(connection: contracts.Connection): boolean {
  const type = connection.type.toLowerCase();
  return type === "mcp" || type === "mcp_server" || type === "tool"
    || connection.provider.toLowerCase() === "mcp";
}

function toHealth(value: string): ConnectionHealth {
  const normalized = value.toLowerCase();
  if (["failed", "failing", "error", "unhealthy"].includes(normalized)) return "failing";
  if (["degraded", "warning", "slow", "not_tested", "pending", "unknown"].includes(normalized)) return "degraded";
  return "healthy";
}
function toType(authType: string, type: string): ConnectionType {
  const value = `${authType} ${type}`.toLowerCase();
  if (value.includes("oauth")) return "oauth";
  if (value.includes("connection") || value.includes("database")) return "connection-string";
  return "api-key";
}
function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}
