/**
 * The time limit a step starts with in the builder.
 *
 * Agent, LLM and general values mirror `WorkflowRuntime.defaultTimeoutFor`. A
 * tool step starts at 30s, the outbound-call limit; the builder writes the value
 * on save, so that is what the worker runs. If either side changes, change both —
 * a panel that draws a limit the runtime does not use is how a 30s agent timeout
 * once shipped unnoticed.
 */
const BY_KIND: Partial<Record<string, number>> = {
  agent: 120_000, // AGENT_NODE_TIMEOUT_MS
  llm: 90_000,    // LLM_NODE_TIMEOUT_MS
  tool: 30_000,   // HTTP_NODE_TIMEOUT_MS
};

/** DEFAULT_NODE_TIMEOUT_MS. */
const GENERAL_MS = 60_000;

export function defaultStepTimeoutMs(kind: string): number {
  return BY_KIND[kind] ?? GENERAL_MS;
}

/**
 * Steps that do no work of their own. They finish immediately, so a limit on
 * them is never worth showing — "60s" on a checkpoint reads as its duration.
 */
const INSTANT_KINDS = new Set(["trigger", "checkpoint", "end", "merge", "branch"]);

/** A limit worth a chip on the canvas: set by the author and not the default. */
export function customStepTimeoutMs(kind: string, timeoutMs: unknown): number | null {
  if (INSTANT_KINDS.has(kind)) return null;
  if (typeof timeoutMs !== "number" || timeoutMs <= 0) return null;
  return timeoutMs === defaultStepTimeoutMs(kind) ? null : timeoutMs;
}
