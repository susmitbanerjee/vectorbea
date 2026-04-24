/**
 * Prompts resource — wraps GET /v1/prompts/:name and POST /v1/audit.
 */

import type { HttpClient } from "../_http.js";
import { Prompt, type PromptPayload } from "../models.js";
import { buildTraceMetadataV1, type CacheStatus, type TraceStatus } from "../trace-metadata.js";

// ── Model cost table ─────────────────────────────────────────────────────────

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "gpt-4o":               { input: 5.00 / 1_000_000,  output: 15.00 / 1_000_000 },
  "gpt-4o-mini":          { input: 0.15 / 1_000_000,  output: 0.60  / 1_000_000 },
  "gpt-4-turbo":          { input: 10.00 / 1_000_000, output: 30.00 / 1_000_000 },
  "gpt-3.5-turbo":        { input: 0.50 / 1_000_000,  output: 1.50  / 1_000_000 },
  "claude-3-5-sonnet-20241022": { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
  "claude-3-haiku-20240307":    { input: 0.25 / 1_000_000, output: 1.25  / 1_000_000 },
};

function costForModel(model: string, tokensIn: number, tokensOut: number) {
  let rates: { input: number; output: number } | undefined = MODEL_COSTS[model];
  if (!rates) {
    const key = Object.keys(MODEL_COSTS).find(k => model.startsWith(k));
    rates = key ? MODEL_COSTS[key] : undefined;
  }
  if (!rates) return { currency: "USD", input_cost: 0, output_cost: 0, total_cost: 0 };
  const inputCost  = tokensIn  * rates.input;
  const outputCost = tokensOut * rates.output;
  return { currency: "USD", input_cost: inputCost, output_cost: outputCost, total_cost: inputCost + outputCost };
}

// ── Response extraction helpers ──────────────────────────────────────────────

function extractOpenAIResponse(response: Record<string, unknown>) {
  const model     = (response.model as string) ?? "unknown-model";
  const usage     = (response.usage as Record<string, number> | undefined) ?? {};
  const tokensIn  = usage.prompt_tokens     ?? 0;
  const tokensOut = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? tokensIn + tokensOut;
  const choices   = response.choices as Array<{ message?: { content?: string }; finish_reason?: string }> | undefined;
  const output    = choices?.[0]?.message?.content ?? "";
  const finishReason = choices?.[0]?.finish_reason;
  return { model, provider: "openai", tokensIn, tokensOut, totalTokens, output, finishReason, cost: costForModel(model, tokensIn, tokensOut) };
}

function extractAnthropicResponse(response: Record<string, unknown>) {
  const model     = (response.model as string) ?? "unknown-model";
  const usage     = (response.usage as Record<string, number> | undefined) ?? {};
  const tokensIn  = usage.input_tokens  ?? 0;
  const tokensOut = usage.output_tokens ?? 0;
  const totalTokens = tokensIn + tokensOut;
  const content   = response.content as Array<{ text?: string }> | undefined;
  const output    = content?.[0]?.text ?? "";
  const finishReason = response.stop_reason as string | undefined;
  return { model, provider: "anthropic", tokensIn, tokensOut, totalTokens, output, finishReason, cost: costForModel(model, tokensIn, tokensOut) };
}

function extractLLMResponse(response: unknown) {
  if (!response || typeof response !== "object") return null;
  const r = response as Record<string, unknown>;
  // Anthropic responses have `content` array + `input_tokens` in usage
  if (Array.isArray(r.content) && (r.usage as Record<string,unknown>)?.input_tokens !== undefined) {
    return extractAnthropicResponse(r);
  }
  // OpenAI responses have `choices` array
  if (Array.isArray(r.choices)) {
    return extractOpenAIResponse(r);
  }
  return null;
}

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
  /** Prompt/proxy resolution latency in milliseconds. */
  proxyLatencyMs?: number;
  /** Round-trip latency of your LLM call in milliseconds. */
  llmLatencyMs?: number;
  /** Total tokens consumed (prompt + completion). */
  tokenCount?: number;
  /** Extra key/value pairs attached to the audit record. */
  metadata?: Record<string, unknown>;
  /** Provider name, e.g. openai, anthropic, or an enterprise gateway label. */
  provider?: string;
  /** Model or gateway model identifier. */
  model?: string;
  /** Prompt/input tokens if available. */
  inputTokens?: number;
  /** Completion/output tokens if available. */
  outputTokens?: number;
  /** Estimated cost metadata. */
  cost?: { currency?: string; inputCost?: number; outputCost?: number; totalCost?: number };
  /** Cache outcome for the execution. */
  cacheStatus?: CacheStatus;
  /** Final text delivered to the caller. */
  outputText?: string;
  /** @internal Distinguishes runtime traces from SDK audit-only prompt fetches. */
  useType?: "runtime" | "audit";
}

// ── TraceSession ─────────────────────────────────────────────────────────────

export interface TraceOptions {
  /** The rendered prompt string sent to the LLM (shown in Span details). */
  inputText?: string;
  /** Sidecar name shown in the SIDECAR card. */
  sidecar?: string;
  /** "prod" or "staging". Defaults to "prod". */
  environment?: string;
  /** Extra metadata merged into the audit record. */
  metadata?: Record<string, unknown>;
  /** Override built-in per-token input cost (USD). */
  costPerInputToken?: number;
  /** Override built-in per-token output cost (USD). */
  costPerOutputToken?: number;
}

export class TraceSession {
  private _model       = "";
  private _provider    = "";
  private _tokensIn    = 0;
  private _tokensOut   = 0;
  private _totalTokens = 0;
  private _outputText  = "";
  private _finishReason = "";
  private _cost: Record<string, unknown> = {};
  private _cacheStatus: CacheStatus = "miss";
  private _guardrail   = "passed";
  private _rag: Record<string, unknown> | null = null;
  private _status: TraceStatus = "success";
  private _llmMs       = 0;
  private _llmStart    = performance.now();
  private _finished    = false;

  constructor(
    private readonly _prompts: Prompts,
    private readonly _prompt: Prompt,
    private readonly _options: TraceOptions,
  ) {}

  /**
   * Auto-extract tokens, cost, model and output from an OpenAI or Anthropic response.
   * Can also accept a plain object with { model, tokensIn, tokensOut, output }.
   */
  record(response: unknown): this {
    this._llmMs = Math.round(performance.now() - this._llmStart);
    const extracted = extractLLMResponse(response);
    if (extracted) {
      this._model      = extracted.model;
      this._provider   = extracted.provider;
      this._tokensIn   = extracted.tokensIn;
      this._tokensOut  = extracted.tokensOut;
      this._totalTokens = extracted.totalTokens;
      this._outputText = extracted.output;
      this._finishReason = extracted.finishReason ?? "";
      if (this._options.costPerInputToken !== undefined) {
        const inp = this._options.costPerInputToken  * this._tokensIn;
        const out = (this._options.costPerOutputToken ?? 0) * this._tokensOut;
        this._cost = { currency: "USD", input_cost: inp, output_cost: out, total_cost: inp + out };
      } else {
        this._cost = extracted.cost;
      }
    } else if (response && typeof response === "object") {
      const manual = response as Record<string, unknown>;
      this._model = typeof manual.model === "string" ? manual.model : this._model;
      this._provider = typeof manual.provider === "string" ? manual.provider : this._provider;
      this._tokensIn = typeof manual.tokensIn === "number" ? manual.tokensIn : this._tokensIn;
      this._tokensOut = typeof manual.tokensOut === "number" ? manual.tokensOut : this._tokensOut;
      this._totalTokens = typeof manual.totalTokens === "number" ? manual.totalTokens : this._tokensIn + this._tokensOut;
      this._outputText = typeof manual.output === "string" ? manual.output : this._outputText;
    }
    return this;
  }

  setCacheStatus(status: CacheStatus): this {
    this._cacheStatus = status;
    return this;
  }

  setGuardrail(action: "passed" | "flagged"): this {
    this._guardrail = action;
    return this;
  }

  setRag(query: string, chunks: unknown[], retrievalMs = 0): this {
    this._rag = { query, chunks, chunks_used: chunks.length, retrieval_ms: retrievalMs };
    return this;
  }

  setStatus(status: TraceStatus): this {
    this._status = status;
    return this;
  }

  private _buildMetadata(): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      cache:    { status: this._cacheStatus },
      guardrail: {
        triggered: this._guardrail !== "passed",
        action: this._guardrail === "passed" ? "allow" : "warn",
      },
      executor: {
        type: "direct_provider",
        ownership: "vectorbea",
        request_mode: "direct",
        response_observability: "full",
      },
      trace:    { environment: this._options.environment ?? "prod", status: this._status },
    };
    if (this._options.sidecar)   meta.sidecar = this._options.sidecar;
    if (this._options.inputText) meta.request = { input: { text: this._options.inputText } };
    if (this._outputText) {
      meta.output = {
        raw_text: this._outputText,
        final_text: this._outputText,
        ...(this._finishReason ? { finish_reason: this._finishReason } : {}),
      };
    }
    if (this._model) {
      meta.model = {
        model:         this._model,
        provider:      this._provider,
        input_tokens:  this._tokensIn,
        output_tokens: this._tokensOut,
        total_tokens:  this._totalTokens || this._tokensIn + this._tokensOut,
        latency_ms:    this._llmMs,
        cost:          this._cost,
      };
    }
    if (this._rag)               meta.retrieval = this._rag;
    if (this._options.metadata)  Object.assign(meta, this._options.metadata);
    return meta;
  }

  /** Flush the audit event. Called automatically when using the trace() callback. */
  async finish(error?: unknown): Promise<void> {
    if (this._finished) return;
    this._finished = true;
    if (error) this._status = "error";
    if (this._llmMs === 0) this._llmMs = Math.round(performance.now() - this._llmStart);
    try {
      await this._prompts.logAudit(this._prompt, {
        proxyLatencyMs: this._prompt._proxyLatencyMs,
        llmLatencyMs: this._llmMs,
        tokenCount:   this._totalTokens || this._tokensIn + this._tokensOut,
        metadata:     this._buildMetadata(),
      });
    } catch (err) {
      console.warn(`[vectorbea] trace flush failed (non-fatal): ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  // TS 5.2+ Symbol.asyncDispose support (works with "await using")
  async [Symbol.asyncDispose](): Promise<void> {
    await this.finish();
  }
}

// ── Prompts class ─────────────────────────────────────────────────────────────

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
    prompt._proxyLatencyMs = proxyLatencyMs;

    // Auto-report prompt fetch as audit-only metadata; traced LLM calls include this latency in the final runtime row.
    this._reportAudit(prompt, { proxyLatencyMs, useType: "audit" }).catch((err: unknown) => {
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
    const metadata = {
      ...(options.metadata ?? {}),
      ...(options.provider || options.model || options.inputTokens !== undefined || options.outputTokens !== undefined
        ? {
            model: {
              ...((options.metadata?.model && typeof options.metadata.model === "object") ? options.metadata.model as Record<string, unknown> : {}),
              ...(options.provider ? { provider: options.provider } : {}),
              ...(options.model ? { model: options.model } : {}),
              ...(options.inputTokens !== undefined ? { input_tokens: options.inputTokens } : {}),
              ...(options.outputTokens !== undefined ? { output_tokens: options.outputTokens } : {}),
              total_tokens: options.tokenCount ?? (options.inputTokens ?? 0) + (options.outputTokens ?? 0),
              latency_ms: options.llmLatencyMs ?? 0,
              ...(options.cost ? { cost: options.cost } : {}),
            },
          }
        : {}),
      ...(options.cacheStatus ? { cache: { status: options.cacheStatus } } : {}),
      ...(options.outputText ? { output: { raw_text: options.outputText, final_text: options.outputText } } : {}),
    };
    await this._reportAudit(prompt, { proxyLatencyMs: 0, ...options, metadata });
  }

  /**
   * Run a traced LLM call — automatically logs a full audit event when the
   * callback resolves (or rejects). No manual `logAudit()` call needed.
   *
   * ```ts
   * // OpenAI
   * const result = await client.prompts.trace(prompt, { inputText: message }, async (t) => {
   *   const response = await openai.chat.completions.create({ model: "gpt-4o", messages });
   *   t.record(response);        // auto-extracts tokens, cost, model, latency
   *   return response.choices[0].message.content;
   * });
   *
   * // Or use "await using" (TypeScript 5.2+):
   * await using t = client.prompts.startTrace(prompt, { inputText: message });
   * const response = await openai.chat.completions.create(...);
   * t.record(response);
   * ```
   */
  async trace<T>(
    prompt: Prompt,
    options: TraceOptions,
    fn: (session: TraceSession) => Promise<T>,
  ): Promise<T> {
    const session = this.startTrace(prompt, options);
    let result: T;
    try {
      result = await fn(session);
    } catch (err) {
      await session.finish(err);
      throw err;
    }
    await session.finish();
    return result;
  }

  /**
   * Start a trace session manually. Call `session.finish()` when done,
   * or use `await using session = client.prompts.startTrace(...)` (TS 5.2+).
   */
  startTrace(prompt: Prompt, options: TraceOptions = {}): TraceSession {
    return new TraceSession(this, prompt, options);
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
      metadata: buildTraceMetadataV1({
        metadata: options.metadata ?? {},
        promptVersionId: prompt._promptVersionId,
        promptName: prompt.name,
        versionTag: prompt.versionTag,
        proxyLatencyMs: options.proxyLatencyMs ?? 0,
        llmLatencyMs: options.llmLatencyMs ?? 0,
        tokenCount: options.tokenCount ?? 0,
        useType: options.useType ?? "runtime",
      }),
    };
    await this.http.post("/v1/audit", payload);
  }
}
