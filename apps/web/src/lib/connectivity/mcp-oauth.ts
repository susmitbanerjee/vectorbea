/**
 * How the MCP sign-in window reports back to the screen that opened it.
 *
 * Shared by the completion page and the connect dialog so the two cannot
 * disagree about a message type or a storage key — a mismatch would not throw,
 * it would leave the dialog waiting forever for a message that did arrive.
 */

/** `postMessage` type, same-origin only. */
export const MCP_OAUTH_MESSAGE = "vectorbea:mcp-oauth";

/**
 * `localStorage` key prefix, suffixed with the connection id.
 *
 * The fallback channel: a `storage` event fires in every other tab of this
 * origin whether or not the sign-in window still has an opener, which many
 * authorization servers sever with Cross-Origin-Opener-Policy.
 */
export const MCP_OAUTH_STORAGE_PREFIX = "vectorbea:mcp-oauth:";

export interface McpOAuthOutcome {
  connectionId: string;
  status: "ok" | "error";
  /** A short machine reason from the API callback, never prose from the provider. */
  reason?: string;
  toolsWritten?: number;
}
