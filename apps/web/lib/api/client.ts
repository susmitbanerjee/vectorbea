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
 * Returns auth headers to attach to every request to the Kotlin API.
 *
 * The Supabase access token is read from the httpOnly cookie named "sb-access-token"
 * that was set by /api/auth/session.  The cookie is NOT accessible from JavaScript
 * (httpOnly) — browsers send it automatically.  Here we read it client-side only
 * when the Kotlin API is an external origin (NEXT_PUBLIC_VECTORBEA_API_URL is set),
 * in which case the cross-origin request needs an explicit Authorization header.
 *
 * When calling relative /api/* paths (Next.js internal API routes), cookies are
 * forwarded automatically by the browser — no header needed.
 *
 * SECURITY: we never read the token from localStorage or any user-visible state.
 * The token is read from document.cookie only when strictly needed for cross-origin
 * requests; the backend re-verifies the JWT cryptographically regardless.
 */
function authHeaders(): Record<string, string> {
  // Only needed when calling the Kotlin API at a different origin
  const base = (typeof process !== "undefined" && process.env.NEXT_PUBLIC_VECTORBEA_API_URL) ?? "";
  if (!base) return {}; // Same-origin: browser forwards cookies automatically

  // Read Supabase access token from the httpOnly cookie if available in JS context.
  // In server-side code this will be empty (cookies() API should be used instead).
  if (typeof document === "undefined") return {};
  const match = document.cookie.match(/(?:^|;\s*)sb-access-token=([^;]+)/);
  const token = match?.[1];
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  return (
    window.localStorage.getItem("vectorbea.activeWorkspaceId")?.trim() ||
    // Public fallback — safe to expose (UUID used as routing hint, not auth boundary)
    process.env.NEXT_PUBLIC_MOCK_ORG_ID?.trim() ||
    ""
  );
}

/**
 * Resolves the active environment ID from URL params or localStorage.
 * Sent as X-Environment-Id header to the Kotlin API.
 */
export function getActiveEnvironmentId(): string {
  if (typeof window === "undefined") {
    return process.env.MOCK_ENV_ID ?? "";
  }
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("environmentId")?.trim();
  if (fromQuery) return fromQuery;
  return (
    window.localStorage.getItem("vectorbea.activeEnvironmentId")?.trim() ||
    // Public fallback — safe to expose (UUID used as routing hint, not auth boundary)
    process.env.NEXT_PUBLIC_MOCK_ENV_ID?.trim() ||
    ""
  );
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

  const workspaceId = getActiveWorkspaceId();
  const environmentId = getActiveEnvironmentId();
  const headers: Record<string, string> = {
    ...authHeaders(),
    ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
    ...(environmentId ? { "X-Environment-Id": environmentId } : {}),
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

// ─── Run streaming ────────────────────────────────────────────────────────────

export interface RunStreamEvent {
  type: string;
  status: string;
  sequence: number;
  title?: string;
  summary?: string;
  source?: string;
  timestamp: string;
  durationMs?: number;
  errorJsonSanitized?: string;
  [key: string]: unknown;
}

export type RunStreamCallback = {
  onEvent?: (event: RunStreamEvent) => void;
  onComplete?: (status: string) => void;
  onHeartbeat?: () => void;
  onError?: (err: Event) => void;
  onUnavailable?: () => void;
};

/**
 * Opens an SSE stream for live run events.
 *
 * Connects to GET /api/runs/{runId}/stream on the Kotlin API.
 * Sends workspace/environment headers via query params (SSE does not support
 * custom headers natively in the browser EventSource API).
 *
 * Returns a cleanup function — call it to close the connection.
 *
 * Falls back to polling if SSE is unavailable (stream_unavailable event).
 */
export function streamRunEvents(
  runId: string,
  workspaceId: string,
  environmentId: string,
  callbacks: RunStreamCallback,
): () => void {
  const base = apiBase();
  const params = new URLSearchParams({
    workspaceId,
    environmentId,
  });
  const url = `${base}/api/runs/${encodeURIComponent(runId)}/stream?${params.toString()}`;

  let es: EventSource | null = null;
  let closed = false;

  function close() {
    closed = true;
    es?.close();
    es = null;
  }

  try {
    es = new EventSource(url, { withCredentials: true });

    es.addEventListener("run_event", (e: MessageEvent) => {
      if (closed) return;
      try {
        const data = JSON.parse(e.data as string) as RunStreamEvent;
        callbacks.onEvent?.(data);
      } catch {
        // ignore malformed event
      }
    });

    es.addEventListener("run_complete", (e: MessageEvent) => {
      if (closed) return;
      try {
        const data = JSON.parse(e.data as string) as { status: string };
        callbacks.onComplete?.(data.status ?? "completed");
      } catch {
        callbacks.onComplete?.("completed");
      }
      close();
    });

    es.addEventListener("stream_unavailable", () => {
      if (closed) return;
      callbacks.onUnavailable?.();
      close();
    });

    es.addEventListener("heartbeat", () => {
      if (closed) return;
      callbacks.onHeartbeat?.();
    });

    es.onerror = (err: Event) => {
      if (closed) return;
      callbacks.onError?.(err);
      // EventSource auto-reconnects on error — don't close unless it's a fatal error
    };
  } catch {
    callbacks.onUnavailable?.();
  }

  return close;
}
