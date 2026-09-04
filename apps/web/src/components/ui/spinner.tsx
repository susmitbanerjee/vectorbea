import * as React from "react";
import { cn } from "~/lib/cn";

/**
 * <Spinner> — the only loading glyph.
 *
 * An arc on a track, rotating. Deliberately not a pulsing dot cluster and not a
 * skeleton: this is "working", not "content is coming". Sized in em so it scales
 * with whatever type it sits beside without a size prop at every call site.
 *
 * Rotation is the one place a continuous animation is allowed (design §7 forbids
 * decorative motion, but a spinner IS the state change). Under
 * prefers-reduced-motion the token layer collapses it to a single 90ms pass, so
 * this falls back to a static arc — still legible as "busy" because the arc is
 * visually distinct from a complete ring.
 */
export interface SpinnerProps extends React.SVGProps<SVGSVGElement> {
  /** Accessible label. Omit only when an ancestor already announces the state. */
  label?: string;
}

export const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(function Spinner(
  { className, label, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 16 16"
      fill="none"
      className={cn("size-[1em] shrink-0 animate-spin", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...props}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.75" opacity="0.25" />
      <path
        d="M14.25 8A6.25 6.25 0 0 0 8 1.75"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
});
