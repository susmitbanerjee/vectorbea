import * as React from "react";
import { Mark } from "./_cell";
import type { IconComponentProps } from "../types";

/* ══════════════════════════════════════════════════════════════════════════════
   GRAPH — the shapes a workflow can take.

   Drawn as cells joined by edges rather than as generic flowchart boxes, so the
   builder canvas and the icon set share one visual language.
══════════════════════════════════════════════════════════════════════════════ */

/** fan-out — one cell dispatching to three. */
export function FanOutIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M3.5 10H7V13L5.5 14.5H2V11.5Z" fill="currentColor" stroke="none" />
      <path d="M7.5 12h3c2 0 2-7 4-7" />
      <path d="M7.5 12h6" />
      <path d="M7.5 12h3c2 0 2 7 4 7" />
      <path d="M16 3.5H20V6.5L18.5 8H14.5V5Z" />
      <path d="M16 10.5H20V13.5L18.5 15H14.5V11.5Z" />
      <path d="M16 17.5H20V20.5L18.5 22H14.5V19Z" />
    </Mark>
  );
}

/** merge — three cells converging into one. */
export function MergeIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M5.5 3.5H9.5V6.5L8 8H4V5Z" />
      <path d="M5.5 10.5H9.5V13.5L8 15H4V11.5Z" />
      <path d="M5.5 17.5H9.5V20.5L8 22H4V19Z" />
      <path d="M10 5c2 0 2 7 4 7" />
      <path d="M10 12h4" />
      <path d="M10 19c2 0 2-7 4-7" />
      <path d="M17 10H21V13L19.5 14.5H15.5V11.5Z" fill="currentColor" stroke="none" />
    </Mark>
  );
}

/** branch — a single decision splitting the path in two. */
export function BranchIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M2.5 12H8" />
      <path d="M9.5 8.5H14.5V13.5L12.5 15.5H7.5V10.5Z" />
      <path d="M15 10.5c3 0 3-5.5 6-5.5" />
      <path d="M15 13.5c3 0 3 5.5 6 5.5" />
    </Mark>
  );
}

/** loop-iterative — a cell re-entering itself until a condition holds. */
export function LoopIterativeIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M6.5 8A6.5 6.5 0 1 1 5.5 14.5" />
      <path d="M9.5 4.5 6 8l3.5 3.5" />
      <path d="M11 10.5H14V13.5L12.5 15H9.5V12Z" fill="currentColor" stroke="none" />
    </Mark>
  );
}

/** wait-until — an arrested arc: motion stopped against a bar, pending a condition. */
export function WaitUntilIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M12 4.5a7.5 7.5 0 1 0 7.5 7.5" />
      <path d="M19.5 4.5V12" />
      <path d="M12 8v4l3 1.8" />
    </Mark>
  );
}
