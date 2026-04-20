/**
 * Internal HTTP transport layer.
 * Not part of the public API — use VectorBeaClient instead.
 */

import {
  APIError,
  AuthenticationError,
  ConnectionError,
  NotFoundError,
  TimeoutError,
} from "./errors.js";

const SDK_VERSION = "0.2.1";

// ── Message sanitisation ──────────────────────────────────────────────────────
//
// Server error bodies may contain internal identifiers (workspace UUIDs, user
// UUIDs, internal service names) that should never be forwarded to the caller.
// Sanitise every server-sourced string before it enters an exception message.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const MAX_MSG_LENGTH = 200;

function sanitize(raw: string): string {
  return raw
    .replace(UUID_RE, "[id]")           // strip workspace / resource UUIDs
    .slice(0, MAX_MSG_LENGTH)           // cap length — avoids huge blobs in logs
    .trim();
}

// ── URL helpers ───────────────────────────────────────────────────────────────
//
// Use only the origin (scheme + host + port) in error messages so that
// embedded credentials in a URL (http://user:pass@host) are never leaked.

function safeOrigin(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}`;
  } catch {
    return url.split("@").pop()?.split("/")[0] ?? url;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string | undefined;
  timeoutMs: number;
}

/** @internal */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly safeOrigin: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor({ baseUrl, apiKey, timeoutMs }: HttpClientOptions) {
    this.baseUrl    = baseUrl.replace(/\/$/, "");
    this.safeOrigin = safeOrigin(this.baseUrl);
    this.timeoutMs  = timeoutMs;
    this.headers    = {
      "Accept":       "application/json",
      "Content-Type": "application/json",
      "User-Agent":   `vectorbea-node/${SDK_VERSION}`,
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };
  }

  async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: this.headers,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (this._isAbortError(err)) {
        throw new TimeoutError(
          `Request to ${this.safeOrigin} timed out after ${this.timeoutMs}ms. ` +
            `Increase the timeout by passing timeoutMs to VectorBeaClient.`
        );
      }
      throw new ConnectionError(
        `Could not connect to VectorBea proxy at ${this.safeOrigin}. ` +
          `Is the container running? Verify Docker is up and port 8080 is mapped.`
      );
    } finally {
      clearTimeout(timer);
    }

    await this._throwForStatus(response, path);
    return response.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (this._isAbortError(err)) {
        throw new TimeoutError(
          `Request to ${this.safeOrigin} timed out after ${this.timeoutMs}ms.`
        );
      }
      throw new ConnectionError(
        `Could not connect to VectorBea proxy at ${this.safeOrigin}.`
      );
    } finally {
      clearTimeout(timer);
    }

    await this._throwForStatus(response, path);
    return response.json() as Promise<T>;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async _throwForStatus(response: Response, path: string): Promise<void> {
    if (response.ok) return;

    // Extract the server's error message and sanitise it before surfacing.
    let raw: string;
    try {
      const body = (await response.json()) as { error?: string };
      raw = typeof body.error === "string" ? body.error : JSON.stringify(body);
    } catch {
      raw = response.statusText || `HTTP ${response.status}`;
    }

    const message = sanitize(raw);
    const status  = response.status;

    if (status === 401) {
      // Do not echo server detail for auth failures — it may contain
      // workspace context that should not be visible to the caller.
      throw new AuthenticationError(
        `Invalid or inactive API key. ` +
          `Regenerate it from the VectorBea dashboard → API Keys.`
      );
    }
    if (status === 404) {
      throw new NotFoundError(
        message ||
          `Resource not found at ${path}. ` +
            `Check the prompt name exists in your workspace and has a published version.`
      );
    }
    throw new APIError(`HTTP ${status}: ${message}`, status);
  }

  private _isAbortError(err: unknown): boolean {
    return (
      err instanceof Error &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    );
  }
}
