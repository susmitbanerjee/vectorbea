/**
 * VectorBeaClient — top-level SDK client.
 */

import { HttpClient } from "./_http.js";
import { Prompts } from "./resources/prompts.js";

const DEFAULT_BASE_URL = "https://app.vectorbea.com";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface VectorBeaClientOptions {
  /**
   * Your workspace API key (starts with `vb_` or `vbagent_`).
   *
   * If omitted the SDK reads the `VECTORBEA_API_KEY` environment variable.
   */
  apiKey?: string;

  /**
   * Base URL of the VectorBea proxy or hub.
   *
   * Defaults to the hosted cloud endpoint. Override to
   * `http://localhost:8080` when running the proxy container locally.
   *
   * Also reads `VECTORBEA_BASE_URL` from the environment if not provided.
   *
   * @default "https://app.vectorbea.com"
   */
  baseUrl?: string;

  /**
   * Request timeout in milliseconds.
   *
   * @default 10_000
   */
  timeoutMs?: number;
}

/**
 * The VectorBea SDK client.
 *
 * Instantiate once and reuse across your application. The client is
 * stateless and safe to share across async contexts.
 *
 * @example
 * **Local proxy (development)**
 * ```ts
 * import { VectorBeaClient } from "@vectorbea-ai/node";
 *
 * const client = new VectorBeaClient({
 *   apiKey:  "vbagent_your_token_here",
 *   baseUrl: "http://localhost:8080",
 * });
 *
 * const prompt  = await client.prompts.get("greet-user");
 * const message = prompt.compile({ name: "Alice", product: "Acme AI" });
 * ```
 *
 * @example
 * **Cloud (production)**
 * ```ts
 * // Reads VECTORBEA_API_KEY from the environment automatically
 * const client = new VectorBeaClient();
 * const prompt  = await client.prompts.get("customer-support-reply");
 * const message = prompt.compile({ customer_name: "Bob", issue: "billing" });
 * ```
 */
export class VectorBeaClient {
  /** Access to the Prompts resource. */
  readonly prompts: Prompts;

  constructor(options: VectorBeaClientOptions = {}) {
    const apiKey =
      options.apiKey ??
      (typeof process !== "undefined" ? process.env["VECTORBEA_API_KEY"] : undefined);

    const baseUrl = (
      options.baseUrl ??
      (typeof process !== "undefined" ? process.env["VECTORBEA_BASE_URL"] : undefined) ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const http = new HttpClient({ baseUrl, apiKey, timeoutMs });
    this.prompts = new Prompts(http);
  }
}
