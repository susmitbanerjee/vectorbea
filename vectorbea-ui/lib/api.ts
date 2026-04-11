export interface AuditLogView {
  timestamp: string;
  workspaceId: string;
  promptName: string;
  versionTag: string;
  proxyLatencyMs: number;
  llmLatencyMs: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface PromptListItem {
  id: string;
  name: string;
  description: string | null;
  latestVersion: string;
  isPublished: boolean;
  updatedAt: string | null;
}

export interface PromptDetail {
  promptId: string;
  promptVersionId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  versionTag: string;
  templateText: string;
  parameters: Record<string, unknown>;
  isPublished: boolean;
  createdAt: string | null;
}

export interface DashboardSummary {
  totalApiCallsLast24h: number;
  averageLatencyMs: number;
  activeAgents: number;
}

export interface DailyRequestPoint {
  day: string;
  requests: number;
}

export type WorkspaceRole = "admin" | "editor" | "viewer";

export interface OrganizationWorkspaceView {
  id: string;
  name: string;
  role?: WorkspaceRole | null;
  organizationId?: string | null;
  organizationName?: string | null;
}

export interface OrganizationView {
  id: string;
  name: string;
  createdAt: string | null;
  role?: WorkspaceRole | null;
  workspaceRole?: WorkspaceRole | null;
  workspaces?: OrganizationWorkspaceView[];
}

export interface ApiKeyView {
  id: string;
  workspaceId: string;
  name: string;
  maskedKey: string;
  createdAt: string;
}

export interface CreateApiKeyResponse {
  id: string;
  workspaceId: string;
  name: string;
  apiKey: string;
  createdAt: string;
}

export interface WorkspaceMember {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "editor" | "viewer";
  joinedAt: string;
}

type ApiFetchOptions = RequestInit & {
  workspaceId?: string | null;
};

function resolveAuthToken(): string {
  const token =
    typeof window === "undefined"
      ? process.env.VECTORBEA_API_KEY
      : null;
  return token ? `Bearer ${token}` : "";
}

function resolveApiUrl() {
  if (typeof window === "undefined") {
    return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  }

  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
}

export function withWorkspaceId(path: string, workspaceId?: string | null) {
  if (!workspaceId) return path;

  const [pathname, hash = ""] = path.split("#", 2);
  const separator = pathname.includes("?") ? "&" : "?";
  return pathname.includes("workspaceId=")
    ? path
    : `${pathname}${separator}workspaceId=${encodeURIComponent(workspaceId)}${hash ? `#${hash}` : ""}`;
}

export async function apiFetch<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const { workspaceId, ...requestInit } = init ?? {};
  const response = await fetch(`${resolveApiUrl()}${withWorkspaceId(path, workspaceId)}`, {
    ...requestInit,
    headers: {
      Authorization: resolveAuthToken(),
      "Content-Type": "application/json",
      ...(requestInit.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`API request failed (${response.status}): ${message}`);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return (await response.json()) as T;
}
