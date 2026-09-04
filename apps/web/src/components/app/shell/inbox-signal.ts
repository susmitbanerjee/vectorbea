/**
 * The one-line bridge between Control and the bell.
 *
 * Control keeps a severity summary — "3 items need attention" — and clicking it
 * must open the inbox, which lives in the topbar on the other side of the shell
 * tree. A context provider would work and would mean threading state through
 * every layout between them for a single boolean.
 *
 * A DOM event is the smaller mechanism, and it is the honest one: "somewhere
 * asked for the inbox" is genuinely a broadcast, not shared state. Anything that
 * wants to offer the same affordance later just fires it.
 */

const OPEN_INBOX = "vectorbea:open-inbox";

/** Ask the notification inbox to open. Safe to call before it mounts — nothing listens, nothing breaks. */
export function openInbox(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_INBOX));
}

/** Subscribe the inbox to open requests. Returns the unsubscribe function. */
export function onOpenInbox(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OPEN_INBOX, handler);
  return () => window.removeEventListener(OPEN_INBOX, handler);
}

/* ── Severity ─────────────────────────────────────────────────────────────── */

/**
 * Severity as the inbox ranks it.
 *
 * `info` is the fourth step the triage feed did not have: it carried only items
 * that needed doing, whereas the inbox also holds things that merely happened.
 * They must not be able to colour the badge.
 */
export type InboxSeverity = "critical" | "high" | "medium" | "info";

export const SEVERITY_RANK: Record<InboxSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
};

/**
 * The badge's colour, from the worst thing in the inbox.
 *
 * This is the whole point of a weighted badge. A raw count says "9" whether
 * that is nine informational run-finished notices or one connection outage
 * taking three workflows down, and an operator glancing at the bell learns
 * nothing from it. The colour answers "does this need me NOW" before the number
 * answers "how much".
 *
 * Brand iris is deliberately not in this list — rule 11: the brand colour never
 * indicates status.
 */
export function badgeTone(worst: InboxSeverity | null): {
  dot: string;
  text: string;
  label: string;
} {
  // `text-fg-on-accent` is the ink for every coloured badge, and it is correct
  // for both fills in both themes because it flips in the same direction they
  // do: dark theme pairs dark ink with a light fill (signal-500 / ember-400),
  // light theme pairs white with a dark one (signal-700 / ember-700).
  //
  // It must NOT be a primitive like `text-graphite-1000`. Only the semantic
  // layer is bridged to utilities, so a primitive class silently does not
  // exist — the same trap as `bg-iris-500`.
  switch (worst) {
    case "critical":
      return { dot: "bg-status-failed", text: "text-fg-on-accent", label: "critical" };
    case "high":
    case "medium":
      return { dot: "bg-status-waiting", text: "text-fg-on-accent", label: "warning" };
    default:
      return { dot: "bg-surface-active", text: "text-fg-primary", label: "informational" };
  }
}

/** The worst severity present, or null when the list is empty. */
export function worstSeverity(severities: InboxSeverity[]): InboxSeverity | null {
  if (severities.length === 0) return null;
  return severities.reduce((worst, s) => (SEVERITY_RANK[s] < SEVERITY_RANK[worst] ? s : worst));
}
