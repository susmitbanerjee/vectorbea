import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Merge conditional class names, resolving Tailwind conflicts so the last
 * utility wins.
 *
 * ── WHY THIS IS NOT PLAIN `twMerge` ──────────────────────────────────────────
 *
 * tailwind-merge resolves conflicts from a built-in map of Tailwind's DEFAULT
 * class names. Our type scale replaces that map entirely: `text-display-md` is a
 * font size and `text-fg-max` is a colour, but out of the box tailwind-merge
 * knows neither, guesses they belong to the same `text-*` group, and silently
 * drops the earlier one.
 *
 * The failure is invisible in review — the class is simply absent from the DOM,
 * with no warning — and it flattened every heading in the system to 14px before
 * a screenshot caught it. Any custom scale sharing a prefix with a built-in
 * group has to be declared here or it will be eaten.
 *
 * Rule of thumb: if you add a token whose utility prefix collides with a
 * Tailwind group (`text-`, `shadow-`, `rounded-`, `duration-`, `ease-`), add its
 * names to the matching group below.
 */

/** Font sizes — src/styles/tokens/typography.css §4.1. */
const FONT_SIZES = [
  "display-2xl", "display-xl", "display-lg", "display-md",
  "heading-lg", "heading-md", "heading-sm",
  "body-lg", "body", "body-sm",
  "label", "caption", "eyebrow",
  "mono", "mono-sm",
] as const;

/** Colours — src/styles/tokens/colour.css semantic layer. */
const COLOURS = [
  "fg-max", "fg-primary", "fg-secondary", "fg-muted", "fg-disabled",
  "fg-on-accent", "fg-link",
  "accent", "accent-hover", "accent-active", "accent-subtle", "accent-border",
  "surface-canvas", "surface-app", "surface-base", "surface-raised",
  "surface-overlay", "surface-sunken", "surface-hover", "surface-active", "surface-selected",
  "edge-subtle", "edge-default", "edge-strong", "edge-focus",
  "status-success", "status-success-subtle", "status-success-border",
  "status-failed", "status-failed-subtle", "status-failed-border",
  "status-live", "status-live-subtle", "status-live-border",
  "status-waiting", "status-waiting-subtle", "status-waiting-border",
  "status-queued", "status-queued-subtle", "status-queued-border",
  "status-cancelled", "status-cancelled-subtle", "status-cancelled-border",
  "risk-low", "risk-medium", "risk-high", "risk-critical",
  "env-production", "env-staging", "env-development",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZES] }],
      "text-color": [{ text: [...COLOURS] }],
      "bg-color": [{ bg: [...COLOURS] }],
      "border-color": [{ border: [...COLOURS] }],
      // Elevation tokens — layout.css bridges --elev-* to shadow-1/2/3.
      "shadow": [{ shadow: ["1", "2", "3"] }],
      // Radii — the six-step scale. v2 does not know `xs`.
      "rounded": [{ rounded: ["xs"] }],
      // Named durations — motion.css declares these as utilities.
      "duration": [{ duration: ["instant", "fast", "base", "slow", "deliberate"] }],
      "ease": [{ ease: ["standard", "entrance", "exit"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
