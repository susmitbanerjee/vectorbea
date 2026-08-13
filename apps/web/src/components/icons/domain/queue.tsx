import * as React from "react";
import { Mark } from "./_cell";
import type { IconComponentProps } from "../types";

/* ══════════════════════════════════════════════════════════════════════════════
   QUEUE — what is waiting, who is taking it, and when it stops flowing.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * queue-depth — cells stacked against a floor.
 *
 * Depth reads vertically: three cells piled on the queue floor, the topmost
 * still open because it is the one most recently accepted.
 */
export function QueueDepthIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M7 3H20V6L18 8H5V5Z" />
      <path d="M7 9.5H20V12.5L18 14.5H5V11.5Z" fill="currentColor" stroke="none" />
      <path d="M7 16H20V19L18 21H5V18Z" fill="currentColor" stroke="none" />
    </Mark>
  );
}

/**
 * worker — a cell with a live core, tethered to the queue.
 *
 * The tether on the left is the lease line back to the queue; the solid core is
 * the job currently in hand. A worker is not a person and is deliberately not
 * drawn as one.
 */
export function WorkerIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M10 6H20V15L17 18H7V9Z" />
      <circle cx="13.5" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <path d="M3 8.5V15.5" />
      <path d="M3 12H7" />
    </Mark>
  );
}

/**
 * backpressure — flow arriving at a wall that will not yield.
 *
 * Two chevrons pressed up against a full-height wall, with the throat between
 * them narrowing. The wall is solid: this is the queue refusing, not failing.
 */
export function BackpressureIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M20 4V20" />
      <path d="M16.5 12H11" />
      <path d="M6 7.5 10.5 12 6 16.5" />
      <path d="M2.5 9.5 5 12l-2.5 2.5" />
    </Mark>
  );
}

/**
 * in-flight — a cell mid-transit.
 *
 * The trailing marks behind it are the distance already covered. Nothing is
 * committed yet, so the cell stays open.
 */
export function InFlightIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M14 7H21V14L18.5 16.5H11.5V9.5Z" />
      <path d="M8 9.5H3" />
      <path d="M8.5 14H5.5" />
      <path d="M6 11.75H2" />
    </Mark>
  );
}
