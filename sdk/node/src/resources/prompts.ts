/**
 * Prompts resource — wraps GET /v1/prompts/:name and POST /v1/audit.
 */

import type { HttpClient } from "../_http.js";
import { Prompt, type PromptPayload } from "../models.js";

interface AuditPayload {
  promptVersionId: string;
  promptName: string;
  versionTag: string;
  proxyLatencyMs: number;
  llmLatencyMs: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface LogAuditOptions {
  /** Round-trip latency of your LLM call in milliseconds. */
  llmLatencyMs?: number;
  /** Total tokens consumed (prompt + completion). */
  tokenCount?: number;
  /** Extra key/value pairs attached to the audit record. */
  metadata?: Record<string, unknown>;
}

/**
 * Provides access to published prompts in your VectorBea workspace.
 *
 * Obtain an instance via `client.prompts`:
 *
 * ```ts
 * import { VectorBeaClient } from "@vectorbea-ai/node";
 *
 * const client = new VectorBeaClient({ apiKey: "vbagent_your_token_here" });
 * const prompt  = await client.prompts.get("greet-user");
 * ```
 */
export class Prompts {
  constructor(private readonly http: HttpClient) {}

  /**
   * Fetch the latest published version of a prompt by name.
   *
   * The proxy fetch latency is measured automatically and reported as an
   * audit event so every call appears in the VectorBea dashboard without
   * any extra instrumentation. Audit failures are swallowed so they never
   * break your application.
   *
   * @param name - The prompt name as defined in the VectorBea dashboard
   *   (e.g. `"greet-user"` or `"summarise-ticket"`).
   * @returns A `Prompt` with a `.compile(variables)` method.
   *
   * @throws `NotFoundError` if the prompt does not exist or has no published version.
   * @throws `AuthenticationError` if the API key is invalid or inactive.
   * @throws `ConnectionError` if the proxy is not reachable.
   * @throws `TimeoutError` if the request exceeds the configured timeout.
   *
   * @example
   * ```ts
   * const prompt  = await client.prompts.get("greet-user");
   * const message = prompt.compile({ name: "Alice", product: "Acme AI" });
   * ```
   */
  async get(name: string): Promise<Prompt> {
    const t0 = performance.now();
    const payload = await this.http.get<PromptPayload>(
      `/v1/prompts/${encodeURIComponent(name)}`
    );
    const proxyLatencyMs = performance.now() - t0;

    const prompt = Prompt.fromPayload(payload);

    // Auto-report the proxy latency — errors are non-fatal
    this._reportAudit(prompt, { proxyLatencyMs }).catch((err: unknown) => {
      // Emit a non-crashing warning — audit must never break the caller
      console.warn(
        `[vectorbea] audit report failed (non-fatal): ${String(err instanceof Error ? err.message : err)}`
      );
    });

    return prompt;
  }

  /**
   * Report a full audit event including LLM latency and token count.
   *
   * `get()` already reports the proxy fetch latency automatically. Call
   * this *after* your LLM responds to add LLM latency and token usage to
   * the same audit record in the dashboard.
   *
   * @example
   * ```ts
   * const prompt  = await client.prompts.get("greet-user");
   * const message = prompt.compile({ name: "Alice" });
   * // ... call your LLM ...
   * await client.prompts.logAudit(prompt, {
   *   llmLatencyMs: 432,
   *   tokenCount: 87,
   *   metadata: { model: "gpt-4o" },
   * });
   * ```
   */
  async logAudit(prompt: Prompt, options: LogAuditOptions = {}): Promise<void> {
    await this._reportAudit(prompt, { proxyLatencyMs: 0, ...options });
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async _reportAudit(
    prompt: Prompt,
    options: { proxyLatencyMs?: number } & LogAuditOptions
  ): Promise<void> {
    const payload: AuditPayload = {
      promptVersionId: prompt._promptVersionId,
      promptName: prompt.name,
      versionTag: prompt.versionTag,
      proxyLatencyMs: options.proxyLatencyMs ?? 0,
      llmLatencyMs: options.llmLatencyMs ?? 0,
      tokenCount: options.tokenCount ?? 0,
      metadata: options.metadata ?? {},
    };
    await this.http.post("/v1/audit", payload);
  }
}
