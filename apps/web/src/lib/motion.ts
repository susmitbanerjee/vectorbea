/**
 * Motion constants — the TypeScript mirror of src/styles/tokens/motion.css.
 *
 * Design direction §7. Import these instead of retyping numbers into a
 * component; the CSS file and this file must always agree.
 */

/** Durations in seconds, the unit Motion expects. */
export const DURATION = {
  instant: 0.09,
  fast: 0.14,
  base: 0.2,
  slow: 0.32,
  deliberate: 0.48,
} as const;

/** Cubic-bezier control points, matching the CSS easing tokens. */
export const EASE = {
  standard: [0.2, 0, 0, 1],
  entrance: [0.16, 1, 0.3, 1],
  exit: [0.4, 0, 1, 1],
} as const;

/** Canvas motion — nodes, panning, layout shifts. */
export const SPRING_CANVAS = {
  type: "spring",
  stiffness: 260,
  damping: 30,
  mass: 0.9,
} as const;

/** Cell motion — Checkpoint Ribbon cells. The brand motion. */
export const SPRING_CELL = {
  type: "spring",
  stiffness: 420,
  damping: 26,
  mass: 0.7,
} as const;

/**
 * Whether the user has asked for reduced motion.
 *
 * Returns false during SSR so the server and the client's first paint agree;
 * components should read this in an effect, or prefer Motion's `useReducedMotion`
 * hook, which handles subscription and hydration correctly.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
