/**
 * Vectorbea API Client
 *
 * Single typed fetch layer used by all frontend code to talk to the backend.
 *
 * TARGET: points at NEXT_PUBLIC_VECTORBEA_API_URL (the Kotlin API service).
 * CURRENT: falls back to "" (relative) so existing Next.js internal API routes
 *          continue to work until each route is migrated to the Kotlin service.
 *
 * Rules:
 *  - NO database imports
 *  - NO secret imports
 *  - NO runtime/executor imports
 *  - NO Redis imports
 *  - Only HTTP over JSON (or SSE for streaming endpoints)
 */

// ─── Base URL ─────────────────────────────────────────────────────────────────

/**
 * Root of the backend API.
 * Set NEXT_PUBLIC_VECTORBEA_API_URL to point at the Kotlin API once deployed.
 * Defaults to "" so all relative /api/* paths continue to work during migration.
 */
function apiBase(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_VECTORBEA_API_URL) {
    return process.env.NEXT_PUBLIC_VECTORBEA_API_URL.replace(/\/$/, "");
  }
  return "";
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Session / auth headers ───────────────────────────────────────────────────

/**
 * Returns auth headers to attach to every request.
 * Currently empty — session is handled via httpOnly cookies set by /api/auth/set-session.
 * When the Kotlin API requires a Bearer token, populate it here from a
 * cookie/session store (never from localStorage or user-visible state).
 */
function authHeaders(): Record<string, string> {
  return {};
}

// ─── Workspace resolution ─────────────────────────────────────────────────────

/**
 * Resolves the active workspace ID from URL params or localStorage.
 * Used as a routing hint only — never as an authorization boundary.
 * The backend always re-validates workspace membership.
 */
export function getActiveWorkspaceId(): string {
  if (typeof window === "undefined") {
    return process.env.MOCK_ORG_ID ?? "";
  }
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("org")?.trim() ?? params.get("workspaceId")?.trim();
  if (fromQuery) return fromQuery;
  return window.localStorage.getItem("vectorbea.activeWorkspaceId")?.trim() ?? "";
}

/**
 * Appends ?workspaceId=<wsId> to `path` when a workspace is active.
 */
export function withWorkspace(path: string, workspaceId?: string): string {
  const wsId = workspaceId ?? getActiveWorkspaceId();
  if (!wsId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}workspaceId=${encodeURIComponent(wsId)}`;
}

// ─── Core fetch helpers ───────────────────────────────────────────────────────

export interface RequestOptions extends Omit<RequestInit, "body" | "headers"> {
  /** JSON body — serialized automatically. */
  json?: unknown;
  /** When true, response body is returned as text instead of parsed JSON. */
  text?: boolean;
  /** Extra headers merged with auth headers. */
  headers?: Record<string, string>;
}

/**
 * Low-level typed fetch.  Resolves path against apiBase() so callers can pass
 * either absolute URLs or /api-relative paths and get the right host in all
 * environments.
 */
export async function apiFetch<T = unknown>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { json, text, headers: extraHeaders, ...init } = opts;

  const url = path.startsWith("http") ? path : `${apiBase()}${path}`;

  const headers: Record<string, string> = {
    ...authHeaders(),
    ...extraHeaders,
  };
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  if (!res.ok) {
    let message = `API error ${res.status}`;
    let body: unknown;
    try {
      body = await res.json();
      if (body && typeof body === "object" && "error" in body) {
        message = String((body as { error: unknown }).error);
      }
    } catch {
      message = (await res.text().catch(() => message)) || message;
    }
    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }

  if (text) return res.text() as Promise<T>;
  return res.json() as Promise<T>;
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export const apiGet = <T>(path: string, opts?: RequestOptions) =>
  apiFetch<T>(path, { method: "GET", ...opts });

export const apiPost = <T>(path: string, body?: unknown, opts?: RequestOptions) =>
  apiFetch<T>(path, { method: "POST", json: body, ...opts });

export const apiPatch = <T>(path: string, body?: unknown, opts?: RequestOptions) =>
  apiFetch<T>(path, { method: "PATCH", json: body, ...opts });

export const apiPut = <T>(path: string, body?: unknown, opts?: RequestOptions) =>
  apiFetch<T>(path, { method: "PUT", json: body, ...opts });

export const apiDelete = <T = void>(path: string, opts?: RequestOptions) =>
  apiFetch<T>(path, { method: "DELETE", ...opts });

// ─── SSE / streaming helper ───────────────────────────────────────────────────

/**
 * Opens a Server-Sent Events stream to `path`.
 * Returns an EventSource pointed at the correct API host.
 * Callers are responsible for closing it.
 */
export function apiEventSource(path: string): EventSource {
  const url = path.startsWith("http") ? path : `${apiBase()}${path}`;
  return new EventSource(url, { withCredentials: true });
}
