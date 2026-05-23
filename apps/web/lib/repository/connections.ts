/**
 * Connections repository — in-memory store.
 * Replace with real API/DB calls when backend is ready.
 */

import type { Connection, ConnectionType, ConnectionStatus } from "@/types/connections";

// ─── Seed data ────────────────────────────────────────────────────────────────

const now = new Date().toISOString();
const past = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

const SEED_CONNECTIONS: Connection[] = [
  {
    id: "conn-openai-prod",
    name: "OpenAI Production",
    slug: "openai-production",
    type: "llm_provider",
    provider: "openai",
    environment: "production",
    status: "connected",
    authType: "api_key",
    secretRef: "openai-prod-key",
    secretMasked: "sk-...k9Xz",
    config: {
      provider: "openai",
      defaultModel: "gpt-4.1-mini",
      allowedModels: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"],
      requestTimeoutMs: 30000,
      tokenBudgetLimit: 1000000,
      rateLimitRpm: 3000,
      rateLimitTpm: 1000000,
    },
    networkPolicy: {
      requireWhitelist: false,
      privateRunnerRequired: false,
      networkStatus: "reachable",
      lastReachabilityTestAt: past(0),
      lastReachabilityTestResult: "ok",
    },
    lastTestedAt: past(0),
    lastTestStatus: "ok",
    lastTestLatencyMs: 142,
    lastTestError: null,
    usedByAgentIds: ["agent-1", "agent-2"],
    usedByToolIds: [],
    createdAt: past(30),
    updatedAt: past(0),
  },
  {
    id: "conn-anthropic-prod",
    name: "Anthropic Production",
    slug: "anthropic-production",
    type: "llm_provider",
    provider: "anthropic",
    environment: "production",
    status: "connected",
    authType: "api_key",
    secretRef: "anthropic-prod-key",
    secretMasked: "sk-ant-...m7Kz",
    config: {
      provider: "anthropic",
      defaultModel: "claude-sonnet-4-5",
      allowedModels: ["claude-opus-4", "claude-sonnet-4-5", "claude-haiku-3-5"],
      requestTimeoutMs: 60000,
      rateLimitRpm: 500,
    },
    networkPolicy: {
      requireWhitelist: false,
      privateRunnerRequired: false,
      networkStatus: "reachable",
      lastReachabilityTestAt: past(1),
      lastReachabilityTestResult: "ok",
    },
    lastTestedAt: past(1),
    lastTestStatus: "ok",
    lastTestLatencyMs: 195,
    lastTestError: null,
    usedByAgentIds: [],
    usedByToolIds: [],
    createdAt: past(20),
    updatedAt: past(1),
  },
  {
    id: "conn-crm-postgres",
    name: "CRM PostgreSQL",
    slug: "crm-postgresql",
    type: "database",
    provider: "postgresql",
    environment: "production",
    status: "needs_whitelist",
    authType: "connection_string",
    secretRef: "crm-db-connection-string",
    secretMasked: "postgres://crm_user:...@crm-db.internal:5432/crm",
    config: {
      provider: "postgresql",
      connectionMode: "connection_string",
      sslRequired: true,
      readOnly: false,
      allowedSchemas: ["public", "crm"],
      allowedTables: ["accounts", "contacts", "opportunities"],
      queryTimeoutMs: 10000,
      maxRows: 1000,
    },
    networkPolicy: {
      requireWhitelist: true,
      privateRunnerRequired: false,
      networkStatus: "whitelist_required",
      allowedHosts: ["crm-db.internal"],
      lastReachabilityTestAt: past(2),
      lastReachabilityTestResult: "failed",
      reachabilityError: "Connection timeout — host unreachable from Vectorbee Cloud. Add outbound IPs to your VPC security group.",
    },
    lastTestedAt: past(2),
    lastTestStatus: "failed",
    lastTestLatencyMs: null,
    lastTestError: "Connection timeout",
    usedByAgentIds: [],
    usedByToolIds: ["tool-1"],
    createdAt: past(14),
    updatedAt: past(2),
  },
  {
    id: "conn-slack-workspace",
    name: "Acme Slack",
    slug: "acme-slack",
    type: "saas",
    provider: "slack",
    environment: "production",
    status: "connected",
    authType: "bearer_token",
    secretRef: "slack-bot-token",
    secretMasked: "xoxb-...9z4k",
    config: {
      provider: "slack",
      workspace: "acme-corp",
      allowedResources: ["#account-health", "#alerts", "#general"],
    },
    networkPolicy: {
      requireWhitelist: false,
      privateRunnerRequired: false,
      networkStatus: "reachable",
    },
    lastTestedAt: past(0),
    lastTestStatus: "ok",
    lastTestLatencyMs: 88,
    lastTestError: null,
    usedByAgentIds: [],
    usedByToolIds: ["tool-2"],
    createdAt: past(25),
    updatedAt: past(0),
  },
  {
    id: "conn-internal-api",
    name: "Internal CRM API",
    slug: "internal-crm-api",
    type: "http_api",
    provider: "http_api",
    environment: "production",
    status: "connected",
    authType: "api_key",
    secretRef: "crm-api-key",
    secretMasked: "crm_...x8Yz",
    config: {
      baseUrl: "https://api.crm.acme-internal.com",
      authType: "api_key",
      defaultHeaders: { "X-Api-Version": "2024-01" },
      allowedPaths: ["/v2/accounts", "/v2/contacts", "/v2/opportunities"],
      blockedPaths: ["/admin", "/internal"],
      requestTimeoutMs: 15000,
      retryAttempts: 2,
    },
    networkPolicy: {
      requireWhitelist: false,
      privateRunnerRequired: false,
      networkStatus: "reachable",
    },
    lastTestedAt: past(1),
    lastTestStatus: "ok",
    lastTestLatencyMs: 231,
    lastTestError: null,
    usedByAgentIds: [],
    usedByToolIds: [],
    createdAt: past(18),
    updatedAt: past(1),
  },
];

// ─── In-memory store ──────────────────────────────────────────────────────────

const _connections: Connection[] = [...SEED_CONNECTIONS];

function sleep(ms = 0) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function getConnections(filters?: {
  type?: ConnectionType;
  status?: ConnectionStatus;
  search?: string;
}): Promise<Connection[]> {
  await sleep();
  let items = [..._connections];
  if (filters?.type) items = items.filter((c) => c.type === filters.type);
  if (filters?.status) items = items.filter((c) => c.status === filters.status);
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    items = items.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.provider.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q),
    );
  }
  return items;
}

export async function getConnection(id: string): Promise<Connection | null> {
  await sleep();
  return _connections.find((c) => c.id === id) ?? null;
}

export async function getConnectionsByType(type: ConnectionType): Promise<Connection[]> {
  await sleep();
  return _connections.filter((c) => c.type === type && c.status !== "disabled");
}

export async function getCompatibleConnectionsForTool(toolType: string): Promise<Connection[]> {
  await sleep();
  const { CONNECTION_TOOL_COMPAT } = await import("@/types/connections");
  const compatTypes = CONNECTION_TOOL_COMPAT[toolType] ?? [];
  return _connections.filter(
    (c) => compatTypes.includes(c.type) && c.status !== "disabled",
  );
}

export async function getCompatibleConnectionsForAgent(agentType: string): Promise<Connection[]> {
  await sleep();
  const { CONNECTION_AGENT_COMPAT } = await import("@/types/connections");
  const compatTypes = CONNECTION_AGENT_COMPAT[agentType] ?? [];
  return _connections.filter(
    (c) => compatTypes.includes(c.type) && c.status !== "disabled",
  );
}

export async function createConnection(payload: Partial<Connection>): Promise<Connection> {
  await sleep();
  const ts = new Date().toISOString();
  const conn: Connection = {
    id: `conn-${Date.now()}`,
    name: payload.name ?? "New Connection",
    slug: (payload.name ?? "new-connection").toLowerCase().replace(/\s+/g, "-"),
    type: payload.type ?? "http_api",
    provider: payload.provider ?? "",
    environment: payload.environment ?? "development",
    status: "not_tested",
    authType: payload.authType ?? "none",
    secretRef: payload.secretRef ?? null,
    secretMasked: payload.secretMasked ?? null,
    config: payload.config ?? ({} as Connection["config"]),
    networkPolicy: payload.networkPolicy ?? {
      requireWhitelist: false,
      privateRunnerRequired: false,
      networkStatus: "unknown",
    },
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestLatencyMs: null,
    lastTestError: null,
    usedByAgentIds: [],
    usedByToolIds: [],
    createdAt: ts,
    updatedAt: ts,
  };
  _connections.push(conn);
  return conn;
}

export async function updateConnection(
  id: string,
  payload: Partial<Connection>,
): Promise<Connection | null> {
  await sleep();
  const idx = _connections.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  _connections[idx] = {
    ..._connections[idx]!,
    ...payload,
    id,
    updatedAt: new Date().toISOString(),
  };
  return _connections[idx]!;
}

export async function deleteConnection(id: string): Promise<boolean> {
  await sleep();
  const idx = _connections.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  _connections.splice(idx, 1);
  return true;
}

/** Simulate a connection test — returns updated connection */
export async function testConnection(id: string): Promise<Connection | null> {
  await sleep(600); // simulate network latency
  const idx = _connections.findIndex((c) => c.id === id);
  if (idx === -1) return null;

  const conn = _connections[idx]!;
  const isPrivate =
    conn.networkPolicy.requireWhitelist ||
    conn.networkPolicy.networkStatus === "whitelist_required";

  const now2 = new Date().toISOString();
  const pass = !isPrivate && Math.random() > 0.1;

  _connections[idx] = {
    ...conn,
    status: pass ? "connected" : "failed",
    lastTestedAt: now2,
    lastTestStatus: pass ? "ok" : "failed",
    lastTestLatencyMs: pass ? Math.round(80 + Math.random() * 300) : null,
    lastTestError: pass ? null : "Connection refused or credentials invalid",
    updatedAt: now2,
  };
  return _connections[idx]!;
}
