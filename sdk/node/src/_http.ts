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

const SDK_VERSION = "0.2.0";

export interface HttpClientOptions {
  baseUrl: string;
  apiKey: string | undefined;
  timeoutMs: number;
}

/** @internal */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor({ baseUrl, apiKey, timeoutMs }: HttpClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": `vectorbea-node/${SDK_VERSION}`,
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
          `Request to ${url} timed out after ${this.timeoutMs}ms. ` +
            `Increase the timeout by passing timeoutMs to VectorBeaClient.`
        );
      }
      throw new ConnectionError(
        `Could not connect to VectorBea proxy at ${this.baseUrl}. ` +
          `Is the container running? Verify Docker is up and port 8080 is mapped. ` +
          `Underlying error: ${String(err instanceof Error ? err.message : err)}`
      );
    } finally {
      clearTimeout(timer);
    }

    await this._throwForStatus(response, url);
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
          `Request to ${url} timed out after ${this.timeoutMs}ms.`
        );
      }
      throw new ConnectionError(
        `Could not connect to VectorBea proxy at ${this.baseUrl}. ` +
          `Underlying error: ${String(err instanceof Error ? err.message : err)}`
      );
    } finally {
      clearTimeout(timer);
    }

    await this._throwForStatus(response, url);
    return response.json() as Promise<T>;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async _throwForStatus(response: Response, url: string): Promise<void> {
    if (response.ok) return;

    let message: string;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? (await response.text());
    } catch {
      message = response.statusText || `HTTP ${response.status}`;
    }

    const status = response.status;

    if (status === 401) {
      throw new AuthenticationError(
        `Invalid or inactive API key. ` +
          `Regenerate it from the VectorBea dashboard → API Keys. ` +
          `Detail: ${message}`
      );
    }
    if (status === 404) {
      throw new NotFoundError(
        message ||
          `Resource not found at ${url}. ` +
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
