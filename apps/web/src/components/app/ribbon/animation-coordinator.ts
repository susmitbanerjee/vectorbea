import * as React from "react";

/* ══════════════════════════════════════════════════════════════════════════════
   THE SINGLE-ANIMATION RULE

   §5 anti-requirements: "Never animate more than one Ribbon at a time in a
   list." This is both a performance and an attention requirement, and it cannot
   be left to call sites — a Runs table renders 163 Ribbons, and if a poll
   updates them together every one blooms at once. The result is a page that
   flickers and a signal that means nothing, because everything moved.

   So the rule is enforced centrally: when a Ribbon detects that one of its cells
   has newly committed, it CLAIMS the animation slot. Only the current claimant
   animates; every other Ribbon applies the same state change without motion.
   The claim is released when the bloom finishes, so a genuinely sequential
   series of commits still animates each one in turn.

   A module-level store rather than context, so a Ribbon works standalone (in
   Storybook, in a card, in a tooltip) with the rule still applied.
══════════════════════════════════════════════════════════════════════════════ */

const BLOOM_MS = 480;

let claimant: string | null = null;
let claimTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Try to take the animation slot. Returns true if this ribbon may animate.
 *
 * First claim wins for the duration of one bloom. Later claims within that
 * window are refused rather than queued: a queue would produce a cascade of
 * blooms across the table seconds after the change, which is worse than not
 * animating at all.
 */
export function claimAnimation(id: string): boolean {
  if (claimant !== null && claimant !== id) return false;

  claimant = id;
  if (claimTimer) clearTimeout(claimTimer);
  claimTimer = setTimeout(() => {
    claimant = null;
    claimTimer = null;
    emit();
  }, BLOOM_MS);

  emit();
  return true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => claimant;
const getServerSnapshot = () => null;

/** The id currently permitted to animate, or null. */
export function useAnimationClaimant(): string | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test hook — resets the module state between stories. */
export function resetAnimationClaim(): void {
  if (claimTimer) clearTimeout(claimTimer);
  claimant = null;
  claimTimer = null;
  emit();
}

export const BLOOM_DURATION_MS = BLOOM_MS;
