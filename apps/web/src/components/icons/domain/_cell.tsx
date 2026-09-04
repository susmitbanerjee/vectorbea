import * as React from "react";
import { STROKE, type IconComponentProps } from "../types";

/**
 * THE CELL — the geometric spine of the bespoke icon set.
 *
 * Design §2: the metaphor is structural, not decorative. Workers lease jobs;
 * each completed node commits a checkpoint that survives a crash; work
 * accumulates in cells that persist. The hexagon is abstracted to the point
 * where it just reads as "precise": a rectangle with the top-left and
 * bottom-right corners clipped, exactly as the Checkpoint Ribbon cell in §5.
 *
 * Every mark in this directory is built from that shape, or from a fragment of
 * it. That shared derivation — not a shared stroke width — is what makes the set
 * cohere and what makes it unmistakably Vectorbea rather than a template.
 *
 *   CELL_LG   4 → 20, clip 4    the whole-icon cell
 *   CELL_MD   6 → 18, clip 3    a cell that shares the frame with something else
 *   CELL_SM   8 → 16, clip 2    a nested or satellite cell
 */
export const CELL_LG = "M8 4H20V16L16 20H4V8Z";
export const CELL_MD = "M9 6H18V15L15 18H6V9Z";
export const CELL_SM = "M10 8H16V14L14 16H8V10Z";

/** Build a cell path for an arbitrary box. Used where a mark needs its own scale. */
export function cellPath(x1: number, y1: number, x2: number, y2: number, clip: number): string {
  return `M${x1 + clip} ${y1}H${x2}V${y2 - clip}L${x2 - clip} ${y2}H${x1}V${y1 + clip}Z`;
}

/**
 * Shared SVG frame. Sets the 24×24 viewBox, currentColor, round caps and joins,
 * and the weight-driven stroke width from one place, so no individual mark
 * restates them.
 */
export function Mark({
  size = 24,
  weight = "regular",
  children,
  ...rest
}: IconComponentProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE[weight]}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}
