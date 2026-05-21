/**
 * Response models returned by the VectorBea SDK.
 */

/** @internal Raw JSON shape returned by GET /v1/prompts/:name */
export interface PromptPayload {
  promptId: string;
  promptVersionId: string;
  organizationId: string;
  name: string;
  versionTag: string;
  templateText: string;
  parameters?: Record<string, unknown>;
  description?: string;
  createdAt?: string;
}

// Matches both {{variable}} and {{ variable }} style placeholders
const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * A resolved, published prompt version fetched from the VectorBea proxy.
 *
 * @example
 * ```ts
 * const prompt = await client.prompts.get("greet-user");
 * const message = prompt.compile({ name: "Alice", product: "Acme AI" });
 * // → "Hello Alice, welcome to Acme AI!"
 * ```
 */
export class Prompt {
  /** Prompt name as registered in the dashboard (e.g. `"greet-user"`). */
  readonly name: string;
  /** Human-readable version label (e.g. `"v1.2.0"`). */
  readonly versionTag: string;
  /** Raw template string with `{{variable}}` placeholders. */
  readonly templateText: string;
  /** Parameter schema defined in the dashboard, keyed by variable name. */
  readonly parameters: Record<string, unknown>;
  /** Optional human-readable description of the prompt's purpose. */
  readonly description: string | undefined;
  /** ISO-8601 timestamp of when this version was created. */
  readonly createdAt: string;
  /** @internal */
  readonly _promptVersionId: string;
  /** @internal Proxy fetch latency measured when this prompt was resolved. */
  _proxyLatencyMs = 0;

  /** @internal Use `Prompt.fromPayload()` instead of constructing directly. */
  constructor(payload: PromptPayload) {
    this._promptVersionId = payload.promptVersionId;
    this.name = payload.name;
    this.versionTag = payload.versionTag;
    this.templateText = payload.templateText;
    this.parameters = payload.parameters ?? {};
    this.description = payload.description;
    this.createdAt = payload.createdAt ?? "";
  }

  /**
   * Render the template by substituting `{{variable}}` placeholders.
   *
   * All `{{key}}` occurrences in `templateText` are replaced with the
   * corresponding value from *variables*. Whitespace inside the braces is
   * ignored, so `{{ name }}` and `{{name}}` are equivalent.
   *
   * @param variables - Mapping of placeholder names to substitution values.
   * @returns Fully rendered prompt string ready to send to an LLM.
   * @throws `Error` if a placeholder in the template has no matching key.
   *
   * @example
   * ```ts
   * prompt.compile({ name: "Bob", product: "VectorBea" });
   * // → "Hello Bob, welcome to VectorBea!"
   * ```
   */
  compile(variables: Record<string, string>): string {
    const missing: string[] = [];

    // Reset lastIndex so the regex is reusable across multiple compile() calls
    PLACEHOLDER_RE.lastIndex = 0;
    for (const match of this.templateText.matchAll(PLACEHOLDER_RE)) {
      const key = match[1]!;
      if (!(key in variables)) missing.push(key);
    }

    if (missing.length > 0) {
      throw new Error(
        `Missing template variables: [${missing.join(", ")}]. ` +
          `Provide them as keys in the variables object passed to .compile().`
      );
    }

    return this.templateText.replace(PLACEHOLDER_RE, (_, key: string) => variables[key]!);
  }

  /** @internal Build a Prompt from the raw API JSON payload. */
  static fromPayload(payload: PromptPayload): Prompt {
    return new Prompt(payload);
  }
}
