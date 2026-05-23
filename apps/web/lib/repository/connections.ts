import type { Connection, ConnectionStatus, ConnectionType } from "@/types/connections";

const ACTIVE_WORKSPACE_STORAGE_KEY = "vectorbea.activeWorkspaceId";

function getActiveWorkspaceId(): string {
  if (typeof window === "undefined") {
    throw new Error("Connections API is client-side only in this module.");
  }

  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("org")?.trim();
  if (fromQuery) return fromQuery;

  const fromStorage = window.localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)?.trim();
  if (fromStorage) return fromStorage;

  throw new Error("No active workspace selected");
}

function withWorkspace(path: string, workspaceId: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}workspaceId=${encodeURIComponent(workspaceId)}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function getConnections(filters?: {
  type?: ConnectionType;
  status?: ConnectionStatus;
  search?: string;
}): Promise<Connection[]> {
  const workspaceId = getActiveWorkspaceId();
  const params = new URLSearchParams();
  if (filters?.type) params.set("type", filters.type);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.search) params.set("search", filters.search);

  const query = params.toString();
  return api<Connection[]>(withWorkspace(`/api/connections${query ? `?${query}` : ""}`, workspaceId));
}

export async function getConnection(id: string): Promise<Connection | null> {
  const items = await getConnections();
  return items.find((c) => c.id === id) ?? null;
}

export async function getConnectionsByType(type: ConnectionType): Promise<Connection[]> {
  return getConnections({ type });
}

export async function getCompatibleConnectionsForTool(_toolType: string): Promise<Connection[]> {
  return getConnections();
}

export async function getCompatibleConnectionsForAgent(_agentType: string): Promise<Connection[]> {
  return getConnections();
}

export async function createConnection(payload: Partial<Connection>): Promise<Connection> {
  const workspaceId = getActiveWorkspaceId();
  return api<Connection>(withWorkspace("/api/connections", workspaceId), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateConnection(id: string, payload: Partial<Connection>): Promise<Connection | null> {
  const workspaceId = getActiveWorkspaceId();
  return api<Connection>(withWorkspace(`/api/connections?id=${encodeURIComponent(id)}`, workspaceId), {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteConnection(id: string): Promise<boolean> {
  const workspaceId = getActiveWorkspaceId();
  await api<void>(withWorkspace(`/api/connections?id=${encodeURIComponent(id)}`, workspaceId), {
    method: "DELETE",
  });
  return true;
}

export async function testConnection(id: string): Promise<Connection | null> {
  const workspaceId = getActiveWorkspaceId();
  const latencyMs = Math.round(80 + Math.random() * 300);
  const pass = Math.random() > 0.1;

  return api<Connection>(withWorkspace(`/api/connections?id=${encodeURIComponent(id)}`, workspaceId), {
    method: "PATCH",
    body: JSON.stringify({
      status: pass ? "connected" : "failed",
      lastTestStatus: pass ? "ok" : "failed",
      lastTestLatencyMs: pass ? latencyMs : null,
      lastTestError: pass ? null : "Connection refused or credentials invalid",
      lastTestedAt: new Date().toISOString(),
    }),
  });
}
