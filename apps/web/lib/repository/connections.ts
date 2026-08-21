import type { Connection, ConnectionStatus, ConnectionType } from "@/types/connections";
import { CONNECTION_TOOL_COMPAT, CONNECTION_AGENT_COMPAT } from "@/types/connections";
import { apiFetch, getActiveWorkspaceId, withWorkspace } from "@/lib/api/client";

// ─── Connection type vocabulary ───────────────────────────────────────────────
// Frontend uses descriptive types; backend stores a shorter vocabulary.
// This map translates before query params are sent to the API.
const CONN_TYPE_TO_API: Record<string, string> = {
  llm_provider:   "llm",
  http_api:       "http",
  mcp_server:     "tool",
  // "database", "vector_store", "object_storage" are the same on both sides
};

function toApiConnectionType(uiType: string | undefined): string | undefined {
  if (!uiType) return uiType;
  return CONN_TYPE_TO_API[uiType] ?? uiType;
}

/**
 * Maps API connection types (backend vocabulary) to frontend display types.
 * The backend stores "llm" | "database" | "http" | "tool".
 * The frontend uses "llm_provider" | "database" | "http_api" | "mcp_server" etc.
 */
function normalizeConnection(conn: Connection): Connection {
  // Map backend type vocab → frontend display types
  const typeMap: Record<string, ConnectionType> = {
    llm:  "llm_provider",
    http: "http_api",
    tool: "mcp_server",
    // "database" is the same on both sides
  };
  const saasProviders = new Set(["gmail", "hubspot", "github"]);
  const apiType = conn.type as string;
  const mappedType = apiType === "http" && saasProviders.has(conn.provider)
    ? "saas"
    : typeMap[apiType];

  // Normalize error field: API returns lastTestErrorMessageSanitized, UI reads lastTestError
  const raw = conn as unknown as {
    lastTestErrorMessageSanitized?: string | null;
    lastTestStatus?: string | null;
  };
  const lastTestError = conn.lastTestError ?? raw.lastTestErrorMessageSanitized ?? null;
  const configuredEnvironment = (conn.config as { environment?: Connection["environment"] } | undefined)?.environment;

  return {
    ...conn,
    ...(mappedType ? { type: mappedType } : {}),
    // Guarantee fields that may be absent in the API response are never undefined
    usedByAgentIds: conn.usedByAgentIds ?? [],
    usedByToolIds:  conn.usedByToolIds  ?? [],
    networkPolicy:  conn.networkPolicy  ?? { requireWhitelist: false, privateRunnerRequired: false, networkStatus: "unknown" },
    config:         conn.config         ?? ({} as Connection["config"]),
    environment:    configuredEnvironment ?? conn.environment ?? "production",
    secretRef:      conn.secretRef      ?? null,
    secretMasked:   conn.secretMasked   ?? null,
    lastTestedAt:          conn.lastTestedAt         ?? null,
    lastTestStatus:        raw.lastTestStatus === "connected" ? "ok" :
                           raw.lastTestStatus === "failed" ? "failed" :
                           conn.lastTestStatus ?? null,
    lastTestLatencyMs:     conn.lastTestLatencyMs     ?? null,
    lastTestError,
    lastTestErrorMessageSanitized: raw.lastTestErrorMessageSanitized ?? null,
    lastTestErrorCode:     conn.lastTestErrorCode     ?? null,
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { method = "GET", body, headers, ...rest } = init ?? {};
  const parsedBody = typeof body === "string" ? (JSON.parse(body) as unknown) : undefined;
  return apiFetch<T>(path, {
    method,
    ...(parsedBody !== undefined ? { json: parsedBody } : {}),
    headers: headers as Record<string, string> | undefined,
    ...rest,
  });
}

export async function getConnections(filters?: {
  type?: ConnectionType;
  status?: ConnectionStatus;
  search?: string;
}): Promise<Connection[]> {
  const workspaceId = getActiveWorkspaceId();
  const params = new URLSearchParams();
  if (filters?.type) params.set("type", toApiConnectionType(filters.type) ?? filters.type);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.search) params.set("search", filters.search);

  const query = params.toString();
  try {
    const res = await api<{ items: Connection[] } | Connection[]>(
      withWorkspace(`/api/connections${query ? `?${query}` : ""}`, workspaceId),
    );
    const raw = Array.isArray(res) ? res : (res as { items: Connection[] }).items ?? [];
    // Deduplicate by id — guards against stale cache returning items that were
    // also present in a concurrent fresh response, or accidental DB duplicates.
    const seen = new Set<string>();
    const items = raw.filter((c) => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
    return items.map(normalizeConnection);
  } catch {
    return [];
  }
}

export async function getConnection(id: string): Promise<Connection | null> {
  const workspaceId = getActiveWorkspaceId();
  try {
    const conn = await api<Connection>(withWorkspace(`/api/connections/${encodeURIComponent(id)}`, workspaceId));
    return normalizeConnection(conn);
  } catch {
    return null;
  }
}

export async function getConnectionsByType(type: ConnectionType): Promise<Connection[]> {
  return getConnections({ type });
}

export async function getCompatibleConnectionsForTool(toolType: string): Promise<Connection[]> {
  const compatTypes = CONNECTION_TOOL_COMPAT[toolType] ?? [];
  if (compatTypes.length === 0) return [];
  // Fetch all and filter client-side — one request, multiple compatible types supported
  const all = await getConnections();
  return all.filter((c) => compatTypes.includes(c.type));
}

export async function getCompatibleConnectionsForAgent(agentType: string): Promise<Connection[]> {
  const compatTypes = CONNECTION_AGENT_COMPAT[agentType] ?? [];
  if (compatTypes.length === 0) return [];
  const all = await getConnections();
  return all.filter((c) => compatTypes.includes(c.type));
}

export async function createConnection(payload: Partial<Connection>): Promise<Connection> {
  const workspaceId = getActiveWorkspaceId();
  const conn = await api<Connection>(withWorkspace("/api/connections", workspaceId), {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return normalizeConnection(conn);
}

export async function updateConnection(id: string, payload: Partial<Connection>): Promise<Connection | null> {
  const workspaceId = getActiveWorkspaceId();
  try {
    const conn = await api<Connection>(withWorkspace(`/api/connections/${encodeURIComponent(id)}`, workspaceId), {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return normalizeConnection(conn);
  } catch {
    return null;
  }
}

export async function deleteConnection(id: string): Promise<boolean> {
  const workspaceId = getActiveWorkspaceId();
  await api<void>(withWorkspace(`/api/connections/${encodeURIComponent(id)}`, workspaceId), {
    method: "DELETE",
  });
  return true;
}

// ─── Schema preview ───────────────────────────────────────────────────────────

export interface SchemaColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string | null;
  maxLength: number | null;
}

export interface SchemaTable {
  schema: string;
  table: string;
  tableType: "TABLE" | "VIEW";
  rowCountEstimate: number | null;
  columns: SchemaColumn[];
}

export interface SchemaPreviewResult {
  schemas: string[];
  tables: SchemaTable[];
  provider: string;
  databaseName: string | null;
  fetchedAt: string;
}

export async function previewDatabaseSchema(params: {
  dbType: string;
  plaintextSecret?: string;   // connection string (sent over TLS, never stored)
  username?: string;
  host?: string;
  port?: number;
  database?: string;
}): Promise<SchemaPreviewResult> {
  return apiFetch<SchemaPreviewResult>("/api/connections/schema-preview", {
    method: "POST",
    json: params,
  });
}

export async function previewSavedConnectionSchema(connectionId: string): Promise<SchemaPreviewResult> {
  return apiFetch<SchemaPreviewResult>(`/api/connections/${encodeURIComponent(connectionId)}/schema-preview`, {
    method: "POST",
    json: {},
  });
}

export interface ConnectionTestResult {
  /** "connected" | "failed" | "private_runner_required" | "whitelist_required" */
  status: string;
  latencyMs: number;
  errorCode: string | null;
  message: string;
  testedAt: string;
  details: Record<string, unknown>;
}

export async function testConnection(id: string): Promise<ConnectionTestResult | null> {
  const workspaceId = getActiveWorkspaceId();
  return api<ConnectionTestResult>(
    withWorkspace(`/api/connections/${encodeURIComponent(id)}/test`, workspaceId),
    { method: "POST" },
  );
}

export async function testUnsavedConnection(payload: {
  type: string;
  provider: string;
  authType: string;
  plaintextSecret?: string;
  config: Record<string, unknown>;
}): Promise<ConnectionTestResult> {
  const workspaceId = getActiveWorkspaceId();
  return api<ConnectionTestResult>(withWorkspace("/api/connections/test-unsaved", workspaceId), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
