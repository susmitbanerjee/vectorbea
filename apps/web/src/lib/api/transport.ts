import type { ZodType } from "zod";

import { DEFAULT_TIMEOUT_MS, MAX_ATTEMPTS, getApiBaseUrl } from "./config";
import { VectorbeaApiError } from "./errors";
import { validateResponse } from "./validate";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Methods safe to replay without the caller opting in. */
const IDEMPOTENT: ReadonlySet<HttpMethod> = new Set<HttpMethod>(["GET", "PUT", "DELETE"]);

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Overrides DEFAULT_TIMEOUT_MS for this call. */
  timeoutMs?: number;
  /** Caller cancellation, composed with the timeout signal. */
  signal?: AbortSignal;
  /**
   * Replay POST/PATCH on transport faults. Off by default: a POST that timed
   * out may well have been applied, and a blind retry doubles it. Opt in only
   * where the endpoint is idempotent in practice or carries an idempotency key.
   */
  retryOnMutation?: boolean;
  headers?: Record<string, string>;
  workspaceId?: string | null;
  environmentId?: string | null;
  /**
   * Contract for the success body. When present, the response is parsed through
   * it and a mismatch becomes a `contract_mismatch` error rather than data the
   * UI will trip over later.
   *
   * Optional so an endpoint without a contract yet is still callable — it just
   * loses the protection.
   */
  schema?: ZodType<unknown>;
}

export interface Transport {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
}

/** Resolves the bearer token. Differs between browser and server. */
export type TokenSource = (options: { forceRefresh: boolean }) => Promise<string | null>;

/** Called when a refresh could not rescue a 401 — the session is genuinely gone. */
export type SessionExpiredHandler = () => void;

export interface FetchTransportOptions {
  getToken: TokenSource;
  onSessionExpired?: SessionExpiredHandler;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function buildUrl(baseUrl: string, path: string, query: RequestOptions["query"]): string {
  const url = new URL(path.startsWith("/") ? baseUrl + path : baseUrl + "/" + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "req_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Exponential backoff with full jitter.
 *
 * Full jitter rather than fixed backoff because the failures worth retrying are
 * the correlated ones: an API restart 503s every open tab at the same instant,
 * and identical backoff would reconverge them into a second stampede.
 */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(8_000, 250 * 2 ** (attempt - 1));
  return Math.random() * ceiling;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    const text = await response.text().catch(() => "");
    if (!text) return null;
    return { error: { code: "HTTP_" + response.status, message: text.slice(0, 500) } };
  }
  return response.json().catch(() => null);
}

/**
 * The live transport.
 *
 * Responsibilities, in the order they apply to a request:
 *   1. Attach the bearer token, workspace/environment headers, and a request id.
 *   2. Race the call against a timeout.
 *   3. On 401, refresh once and replay. A second 401 ends the session.
 *   4. On 502/503/504 or a network fault, retry with jittered backoff.
 *   5. On anything else, raise a typed VectorbeaApiError.
 *
 * 4xx is never retried: the request is wrong, and repeating it stays wrong.
 */
export function createFetchTransport(options: FetchTransportOptions): Transport {
  const doFetch = options.fetchImpl ?? globalThis.fetch;

  return {
    async request<T>(path: string, init: RequestOptions = {}): Promise<T> {
      const baseUrl = options.baseUrl ?? getApiBaseUrl();
      const method = init.method ?? "GET";
      const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const url = buildUrl(baseUrl, path, init.query);
      const requestId = newRequestId();

      const mayRetry = IDEMPOTENT.has(method) || init.retryOnMutation === true;
      const maxAttempts = mayRetry ? MAX_ATTEMPTS : 1;

      let refreshed = false;
      let attempt = 0;
      /**
       * The token a forced refresh handed back.
       *
       * Held explicitly rather than re-reading from `getToken` on the replay:
       * that would only work because the browser token provider caches, and it
       * would silently send the stale token again for any source that does not.
       * The replay must use the token the refresh actually produced.
       */
      let refreshedToken: string | null = null;

      // One loop covers both retry kinds. `attempt` only advances for backoff
      // retries; a 401 refresh replays without consuming the retry budget,
      // because a stale token is not the fault backoff exists to absorb.
      for (;;) {
        attempt += 1;

        const token = refreshedToken ?? (await options.getToken({ forceRefresh: false }));

        const timeoutController = new AbortController();
        const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
        const onCallerAbort = () => timeoutController.abort();
        init.signal?.addEventListener("abort", onCallerAbort, { once: true });

        const headers: Record<string, string> = {
          Accept: "application/json",
          "X-Request-Id": requestId,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(init.workspaceId ? { "X-Workspace-Id": init.workspaceId } : {}),
          // Environment is no longer a client-selected scope. The API derives
          // its legacy storage partition from the verified workspace on writes.
          ...init.headers,
        };

        let response: Response;
        try {
          response = await doFetch(url, {
            method,
            headers,
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            signal: timeoutController.signal,
            // Cross-origin API. The bearer token is the credential, not a cookie.
            credentials: "omit",
          });
        } catch (cause) {
          clearTimeout(timer);
          init.signal?.removeEventListener("abort", onCallerAbort);

          // Three ways an abort can happen; only one is the caller's doing.
          if (init.signal?.aborted) throw VectorbeaApiError.aborted(requestId);

          const isAbort = cause instanceof Error && cause.name === "AbortError";
          const error = isAbort
            ? VectorbeaApiError.timeout(timeoutMs, requestId)
            : VectorbeaApiError.network(cause, requestId);

          if (attempt < maxAttempts) {
            await sleep(backoffMs(attempt), init.signal);
            continue;
          }
          throw error;
        }

        clearTimeout(timer);
        init.signal?.removeEventListener("abort", onCallerAbort);

        if (response.ok) {
          const body = await readBody(response);
          // Validate against the contract before anything downstream sees it.
          // The server's request id is preferred over ours: it is the one in
          // the API's logs, which is where a mismatch gets diagnosed.
          return validateResponse<T>(init.schema as ZodType<T> | undefined, body, {
            path: `${method} ${path}`,
            requestId: response.headers.get("X-Request-Id") ?? requestId,
          });
        }

        // 401: refresh once, then replay.
        if (response.status === 401) {
          if (!refreshed) {
            refreshed = true;
            const next = await options.getToken({ forceRefresh: true });
            if (next) {
              refreshedToken = next;
              attempt -= 1; // a refresh replay is not a backoff retry
              continue;
            }
          }
          // Either no token came back, or a fresh token was rejected too.
          options.onSessionExpired?.();
          throw VectorbeaApiError.fromResponse(response, await readBody(response), requestId);
        }

        const body = await readBody(response);
        const error = VectorbeaApiError.fromResponse(response, body, requestId);

        const retryableStatus =
          response.status === 502 || response.status === 503 || response.status === 504;

        if (retryableStatus && attempt < maxAttempts) {
          // Honour Retry-After when the server sent one, else jittered backoff.
          const wait =
            error.retryAfterSeconds !== null
              ? Math.min(error.retryAfterSeconds * 1000, 10_000)
              : backoffMs(attempt);
          await sleep(wait, init.signal);
          continue;
        }

        throw error;
      }
    },
  };
}
