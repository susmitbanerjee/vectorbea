import type { Connection, ConnectionStatus, ConnectionType } from "@/types/connections";
import { apiFetch, getActiveWorkspaceId, withWorkspace } from "@/lib/api/client";

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
  if (filters?.type) params.set("type", filters.type);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.search) params.set("search", filters.search);

  const query = params.toString();
  try {
    const res = await api<{ items: Connection[] } | Connection[]>(
      withWorkspace(`/api/connections${query ? `?${query}` : ""}`, workspaceId),
    );
    return Array.isArray(res) ? res : (res as { items: Connection[] }).items ?? [];
  } catch {
    return [];
  }
}

export async function getConnection(id: string): Promise<Connection | null> {
  const workspaceId = getActiveWorkspaceId();
  try {
    return await api<Connection>(withWorkspace(`/api/connections/${encodeURIComponent(id)}`, workspaceId));
  } catch {
    return null;
  }
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
  try {
    return await api<Connection>(withWorkspace(`/api/connections/${encodeURIComponent(id)}`, workspaceId), {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
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

export async function testConnection(id: string): Promise<Connection | null> {
  const workspaceId = getActiveWorkspaceId();
  return api<Connection>(
    withWorkspace(`/api/connections/${encodeURIComponent(id)}/test`, workspaceId),
    { method: "POST" },
  );
}
