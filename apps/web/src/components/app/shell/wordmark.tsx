import * as React from "react";
import { cn } from "~/lib/cn";

/**
 * The Vectorbea wordmark.
 *
 * The mark is a checkpoint cell — the same clipped-corner geometry as the icon
 * set and the Checkpoint Ribbon — filled, because a committed cell is the one
 * idea the whole product is built on. It is iris: this is identity, and iris is
 * the only hue permitted to mean "Vectorbea" (§3.3).
 *
 * Collapsed, the wordmark drops to the mark alone. The letterforms at 56px would
 * be 8px tall and illegible, which is worse than no wordmark.
 */
export function Wordmark({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <svg viewBox="0 0 24 24" className="text-accent size-6 shrink-0" fill="none" aria-hidden="true" focusable="false">
        {/* Filled cell — committed work. */}
        <path d="M8 4H20V16L16 20H4V8Z" fill="currentColor" />
        {/* Commit boundary, in the surface colour so it reads as a cut. */}
        <path d="M12 4V20" stroke="var(--bg-base)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {collapsed ? null : (
        <span className="font-display text-heading-sm text-fg-max font-bold tracking-tight">
          Vectorbea
        </span>
      )}
      <span className="sr-only">Vectorbea</span>
    </span>
  );
}
