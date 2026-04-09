export interface AuditLogView {
  timestamp: string;
  organizationId: string;
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
  organizationId: string;
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

export interface OrganizationView {
  id: string;
  name: string;
  createdAt: string | null;
}

export interface ApiKeyView {
  id: string;
  organizationId: string;
  name: string;
  maskedKey: string;
  createdAt: string;
}

export interface CreateApiKeyResponse {
  id: string;
  organizationId: string;
  name: string;
  apiKey: string;
  createdAt: string;
}

const DEV_TOKEN = "Bearer dev_org_123";

function resolveApiUrl() {
  if (typeof window === "undefined") {
    return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  }

  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${resolveApiUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: DEV_TOKEN,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
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
