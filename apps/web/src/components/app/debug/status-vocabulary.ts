import {
  CheckCircle, WarningCircle, Clock, Prohibit, Play, Warning,
  ArrowsClockwise, Scissors, Gauge, UserCheck,
} from "@phosphor-icons/react/dist/ssr";
import type { IconComponent } from "~/components/icons/types";
import type { SpanStatus } from "~/lib/api/trace";

/**
 * One status vocabulary for every view in the Debug tab.
 *
 * ── WHY THIS IS A MODULE AND NOT A CONVENTION ───────────────────────────────
 * The run map, the waterfall and the inspector must agree. A node that is red in
 * the map and amber in the timeline is worse than either being wrong alone,
 * because the reader stops debugging their run and starts debugging the
 * debugger. Four views that each "follow the convention" drift on the first
 * hurried change; one exported table cannot.
 *
 * ── COLOUR IS NEVER THE ONLY ENCODING ───────────────────────────────────────
 * Every tone carries FOUR redundant signals: colour, an icon, a border style and
 * a word. That is not belt-and-braces — roughly one in twelve men cannot
 * separate the red and green that carry "failed" and "succeeded", and the whole
 * page is built on that one distinction. The border style matters most for the
 * two states that are not colour at all: `skipped` is dashed because it never
 * happened, and `failed` is 2px because it is the one thing the reader came for.
 *
 * Every colour is a SEMANTIC token. Status colour never comes from the brand
 * ramp — iris means "this is ours", never "this is fine".
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

/** The graph endpoint's extra status: a node the run never got to. */
export function toneForNodeStatus(status: string): SpanTone {
  if (status === "not_reached") return "skipped";
  return TONE_FOR_STATUS[status as SpanStatus] ?? "skipped";
}

export interface ToneStyle {
  /** Foreground for text and glyphs on a subtle fill. */
  text: string;
  /** 1px border for ordinary members of this tone. */
  border: string;
  /** Fill for cards and pills. */
  fill: string;
  /** Solid swatch, for dots and bar segments. */
  solid: string;
  /**
   * Border STYLE, the encoding that survives greyscale and colour blindness.
   * `skipped` is dashed because it never ran; `failed` is heavy because it is
   * the answer.
   */
  borderStyle: "solid" | "dashed";
  borderWidth: "border" | "border-2";
  icon: IconComponent;
  label: string;
}

export const TONE: Record<SpanTone, ToneStyle> = {
  success: {
    text: "text-status-success",
    border: "border-status-success-border",
    fill: "bg-status-success-subtle",
    solid: "bg-status-success",
    borderStyle: "solid",
    borderWidth: "border",
    icon: CheckCircle,
    label: "Succeeded",
  },
  failed: {
    text: "text-status-failed",
    border: "border-status-failed-border",
    fill: "bg-status-failed-subtle",
    solid: "bg-status-failed",
    borderStyle: "solid",
    /* The failing node is the answer. 2px is the difference between finding it
       in ten seconds and reading every duration on the page. */
    borderWidth: "border-2",
    icon: WarningCircle,
    label: "Failed",
  },
  waiting: {
    text: "text-status-waiting",
    border: "border-status-waiting-border",
    fill: "bg-status-waiting-subtle",
    solid: "bg-status-waiting",
    borderStyle: "solid",
    borderWidth: "border",
    icon: Clock,
    label: "Waiting",
  },
  running: {
    text: "text-status-live",
    border: "border-status-live-border",
    fill: "bg-status-live-subtle",
    solid: "bg-status-live",
    borderStyle: "solid",
    borderWidth: "border",
    icon: Play,
    label: "Running",
  },
  /*
   * `skipped` deliberately has no status colour of its own. A node that never
   * ran is not a state the run reached, and giving it a status hue would put it
   * on the same footing as the states it did reach. Muted on a sunken surface,
   * with a DASHED border doing the work colour is not — which is also why it
   * stays legible when the whole card is dimmed to 45%.
   */
  skipped: {
    text: "text-fg-disabled",
    border: "border-subtle",
    fill: "bg-surface-sunken",
    solid: "bg-fg-disabled",
    borderStyle: "dashed",
    borderWidth: "border",
    icon: Prohibit,
    label: "Not reached",
  },
};

/** @deprecated Use {@link TONE}. Kept while the older views migrate. */
export const TONE_CLASSES: Record<SpanTone, { text: string; border: string; fill: string; dot: string }> =
  Object.fromEntries(
    Object.entries(TONE).map(([k, v]) => [k, { text: v.text, border: v.border, fill: v.fill, dot: v.solid }]),
  ) as Record<SpanTone, { text: string; border: string; fill: string; dot: string }>;

export const TONE_LABEL: Record<SpanTone, string> =
  Object.fromEntries(Object.entries(TONE).map(([k, v]) => [k, v.label])) as Record<SpanTone, string>;

// ── Warnings ────────────────────────────────────────────────────────────────

/**
 * The vocabulary for things that leave a run GREEN but are still worth seeing.
 *
 * A run that succeeded after two retries with a truncated context is one
 * provider hiccup from failing, and its agent reasoned from incomplete
 * information. Without these a healthy-looking run has nothing to show for
 * itself, and the reader has no way to tell the two apart.
 */
export interface WarningStyle {
  icon: IconComponent;
  label: string;
  /** Warnings are amber at most: none of them failed the run. */
  tone: "waiting" | "muted";
}

export const WARNING: Record<string, WarningStyle> = {
  retry: { icon: ArrowsClockwise, label: "Retried", tone: "waiting" },
  context_truncated: { icon: Scissors, label: "Context truncated", tone: "waiting" },
  budget_clamped: { icon: Gauge, label: "Budget clamped", tone: "waiting" },
  approval: { icon: UserCheck, label: "Waited for approval", tone: "muted" },
};

export function warningStyle(kind: string): WarningStyle {
  return WARNING[kind] ?? { icon: Warning, label: kind.replace(/_/g, " "), tone: "muted" };
}

// ── Run bar ─────────────────────────────────────────────────────────────────

/**
 * How the run spent its wall clock.
 *
 * `parked` gets the waiting hue and `working` gets a NEUTRAL surface rather than
 * a status colour, because working is not an outcome — colouring it green would
 * claim the run succeeded while it was still going.
 */
export const SEGMENT: Record<string, { solid: string; text: string; label: string }> = {
  queued:  { solid: "bg-fg-disabled",     text: "text-fg-secondary",   label: "Queued" },
  working: { solid: "bg-fg-secondary",    text: "text-fg-secondary",   label: "Working" },
  parked:  { solid: "bg-status-waiting",  text: "text-status-waiting", label: "Parked" },
  failed:  { solid: "bg-status-failed",   text: "text-status-failed",  label: "Failed" },
};

// ── Kinds and wait reasons ──────────────────────────────────────────────────

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
 * sentence saying the run was fine and something else was slow.
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
