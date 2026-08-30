import type { SpanStatus } from "~/lib/api/trace";

/**
 * One status vocabulary, shared by all three views.
 *
 * Defined once because the run map, the waterfall and the inspector must agree:
 * a node that is red in the map and amber in the timeline is worse than either
 * being wrong on its own, because now the reader is debugging the debugger.
 *
 * Every value is a SEMANTIC token. Status colour never comes from the brand
 * ramp — iris means "this is ours", never "this is fine" — and the tokens keep
 * the two disjoint by construction.
 */

export type SpanTone = "success" | "failed" | "waiting" | "skipped" | "running";

export const TONE_FOR_STATUS: Record<SpanStatus, SpanTone> = {
  ok: "success",
  error: "failed",
  paused: "waiting",
  skipped: "skipped",
  cancelled: "skipped",
  running: "running",
};

/**
 * Text, border and fill for each tone.
 *
 * `skipped` deliberately has no status token of its own: a node that never ran
 * is not a state the run reached, and colouring it would put it on the same
 * footing as the states it did. Muted foreground on the app background says
 * "this did not happen" without competing for attention.
 */
export const TONE_CLASSES: Record<SpanTone, { text: string; border: string; fill: string; dot: string }> = {
  success: {
    text: "text-status-success",
    border: "border-status-success-border",
    fill: "bg-status-success-subtle",
    dot: "bg-status-success",
  },
  failed: {
    text: "text-status-failed",
    border: "border-status-failed-border",
    fill: "bg-status-failed-subtle",
    dot: "bg-status-failed",
  },
  waiting: {
    text: "text-status-waiting",
    border: "border-status-waiting-border",
    fill: "bg-status-waiting-subtle",
    dot: "bg-status-waiting",
  },
  running: {
    text: "text-status-live",
    border: "border-status-live-border",
    fill: "bg-status-live-subtle",
    dot: "bg-status-live",
  },
  skipped: {
    text: "text-fg-disabled",
    border: "border-subtle",
    fill: "bg-surface-sunken",
    dot: "bg-fg-disabled",
  },
};

/**
 * The word, not a glyph.
 *
 * The design sketch uses ✓ ✗ ⧗ ⊘ ▶. Those are decoration on top of colour, and
 * colour plus symbol still leaves a screen reader with nothing — so the label is
 * the accessible name and the shape is the redundant encoding beside it. Also
 * satisfies "no emoji anywhere in the UI": these are typographic marks with text
 * equivalents, not emoji, and the text is what is announced.
 */
export const TONE_LABEL: Record<SpanTone, string> = {
  success: "Succeeded",
  failed: "Failed",
  waiting: "Waiting",
  running: "Running",
  skipped: "Not reached",
};

/** Human duration. Milliseconds below a second, else seconds, else minutes. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/** Cents to a currency string. Sub-cent costs still deserve a real number. */
export function formatCost(cents: number | null | undefined): string {
  if (cents == null) return "—";
  if (cents < 1) return `${cents.toFixed(2)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

/** The kind, as a person would say it. */
export const KIND_LABEL: Record<string, string> = {
  run: "Run",
  tick: "Tick",
  step: "Step",
  input_mapping: "Input mapping",
  llm_call: "Model call",
  tool_call: "Tool call",
  approval: "Approval",
  retry: "Retry",
  checkpoint: "Checkpoint",
  wait: "Waiting",
  activation: "Agent",
  iteration: "Iteration",
  handoff: "Handoff",
};

/**
 * Why a run was parked, in words.
 *
 * An unlabelled gap in a waterfall generates more support tickets than an error
 * does, because it looks like the product hanging. Every wait reason gets a
 * sentence that says the run was fine and something else was slow.
 */
export const WAIT_REASON_LABEL: Record<string, string> = {
  queue: "Waiting in the queue for a worker",
  approval: "Waiting for someone to approve",
  throttle: "Waiting out a provider rate limit",
  timer: "Waiting for a scheduled timer",
  tenant_admission: "Waiting for workspace capacity",
  child: "Waiting for a child run",
};

export function waitReasonOf(span: { name: string }): string {
  const reason = span.name.startsWith("wait:") ? span.name.slice(5) : span.name;
  return WAIT_REASON_LABEL[reason] ?? `Waiting (${reason})`;
}
