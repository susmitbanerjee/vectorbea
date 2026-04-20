/**
 * @vectorbea-ai/node — Official Node.js / TypeScript SDK
 *
 * @example
 * ```ts
 * import { VectorBeaClient } from "@vectorbea-ai/node";
 *
 * const client = new VectorBeaClient({
 *   apiKey:  process.env.VECTORBEA_API_KEY,
 *   baseUrl: "http://localhost:8080",   // omit for cloud
 * });
 *
 * const prompt  = await client.prompts.get("greet-user");
 * const message = prompt.compile({ name: "Alice", product: "Acme AI" });
 * console.log(message); // "Hello Alice, welcome to Acme AI!"
 * ```
 */

// Client
export { VectorBeaClient } from "./client.js";
export type { VectorBeaClientOptions } from "./client.js";

// Models
export { Prompt } from "./models.js";
export type { PromptPayload } from "./models.js";

// Resources
export { Prompts } from "./resources/prompts.js";
export type { LogAuditOptions } from "./resources/prompts.js";

// Errors — export every class so callers can use instanceof checks
export {
  VectorBeaError,
  APIError,
  AuthenticationError,
  NotFoundError,
  ConnectionError,
  TimeoutError,
} from "./errors.js";
