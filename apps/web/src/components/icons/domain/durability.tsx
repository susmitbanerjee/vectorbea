import * as React from "react";
import { Mark } from "./_cell";
import type { IconComponentProps } from "../types";

/* ══════════════════════════════════════════════════════════════════════════════
   DURABILITY — the six marks that carry the product thesis.

   These describe the one thing no competitor renders: how much committed work
   survives a failure. None of them exist in any icon library, which is precisely
   why they are worth drawing.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * checkpoint — a FILLED cell against a commit boundary.
 *
 * Not a bookmark, not a flag. The cell is solid because the work inside it is
 * durable; the rail on the right is the boundary it committed at. Solid-cell +
 * boundary is the visual root of the whole set.
 */
export function CheckpointIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M8 5H17V14L14 17H5V8Z" fill="currentColor" stroke="none" />
      <path d="M20.5 4.5V19.5" />
    </Mark>
  );
}

/**
 * resume-from-checkpoint — a committed cell with execution re-entering it.
 *
 * The arc returns from beyond the boundary and points back into the cell: work
 * restarts *at* the last commit, not at the beginning.
 */
export function ResumeFromCheckpointIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M6 6H14V14L11.5 16.5H3.5V8.5Z" fill="currentColor" stroke="none" />
      <path d="M17 8.5A5.5 5.5 0 1 1 12.5 19" />
      <path d="M13.5 4.5 17.5 8.5 13.5 12" />
    </Mark>
  );
}

/**
 * durable-run — a sequence of cells on a persistence rail.
 *
 * Two cells committed, the third still open, all sitting on a continuous rail.
 * The rail is the durability: the run can stop anywhere along it without losing
 * what is already behind it.
 */
export function DurableRunIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M4 5H8V11L6 13H2V7Z" fill="currentColor" stroke="none" />
      <path d="M11 5H15V11L13 13H9V7Z" fill="currentColor" stroke="none" />
      <path d="M18 5H22V11L20 13H16V7Z" />
      <path d="M2.5 17.5H21.5" />
    </Mark>
  );
}

/** replay — the run cycled back around a single committed cell. */
export function ReplayIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20.5 4v4.5H16" />
      <path d="M11 10H14V13L12.5 14.5H9.5V11.5Z" fill="currentColor" stroke="none" />
    </Mark>
  );
}

/**
 * lease — a cell held for a bounded time.
 *
 * A worker does not own a job, it leases it: the cell is claimed, and the clock
 * on its shoulder is the expiry that hands it back if the worker dies.
 */
export function LeaseIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M6 8H13V15L11 17H4V10Z" />
      <circle cx="17" cy="8" r="4.5" />
      <path d="M17 5.6V8l1.8 1.2" />
    </Mark>
  );
}

/**
 * commit-boundary — the line durability is measured against.
 *
 * Left of the rule the work is committed and solid; right of it the next cell is
 * still open. The rule is the subject of the mark, so it runs the full height.
 */
export function CommitBoundaryIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M5 6H10V15L7 18H2V9Z" fill="currentColor" stroke="none" />
      <path d="M17 6H22V15L19 18H14V9Z" />
      <path d="M12 3V21" />
    </Mark>
  );
}
