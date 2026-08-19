export type ConnectionHealth = "healthy" | "degraded" | "failing";
export type ConnectionType = "oauth" | "api-key" | "connection-string";

export interface ConnectionRecord {
  id: string;
  name: string;
  provider: string;
  type: ConnectionType;
  status: ConnectionHealth;
  latencyMs: number | null;
  latencyTrend: number[];
  lastCheckedAt: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string | null;
  readOnly: boolean;
  scopes: string[];
  healthHistory: ConnectionHealth[];
  recentErrors: { runId: string; at: string; message: string }[];
  audit: { at: string; actor: string; action: string }[];
  needsPrivateRunner: boolean;
  tools: string[];
  agents: string[];
}

export const AUTH_LABEL: Record<ConnectionType, string> = {
  oauth: "OAuth 2.0",
  "api-key": "API key",
  "connection-string": "Connection string",
};

export interface BlastRadius {
  workflows: { id: string; name: string; environment: "production"; nodeName: string }[];
  tools: string[];
  agents: string[];
  queuedRuns: number;
  queuedRunIds: string[];
  sentence: string;
}

export function blastRadius(connection: ConnectionRecord): BlastRadius {
  const parts = [
    connection.tools.length ? `${connection.tools.length} ${connection.tools.length === 1 ? "tool" : "tools"}` : "",
    connection.agents.length ? `${connection.agents.length} ${connection.agents.length === 1 ? "agent" : "agents"}` : "",
  ].filter(Boolean);
  return {
    workflows: [],
    tools: connection.tools,
    agents: connection.agents,
    queuedRuns: 0,
    queuedRunIds: [],
    sentence: parts.length ? `Directly used by ${parts.join(" and ")}.` : "Nothing directly depends on this connection yet.",
  };
}

export function healthSummary(rows: ConnectionRecord[]) {
  return {
    connected: rows.filter((row) => row.status === "healthy").length,
    degraded: rows.filter((row) => row.status === "degraded").length,
    failing: rows.filter((row) => row.status === "failing").length,
    expiring: rows.filter((row) => row.expiresAt && Date.parse(row.expiresAt) <= Date.now() + 14 * 86_400_000).length,
  };
}
