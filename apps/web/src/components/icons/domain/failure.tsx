import * as React from "react";
import { Mark } from "./_cell";
import type { IconComponentProps } from "../types";

/* ══════════════════════════════════════════════════════════════════════════════
   FAILURE — what broke, how far it reached, and why.

   The shared device is the FRACTURE: a cell split by a jagged seam. Reused at
   three scales so incident, blast-radius and root-cause read as one family
   rather than three unrelated warnings. None of them is a warning triangle.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * incident — a cell broken through.
 *
 * The seam runs corner to corner and the two halves have pulled apart slightly.
 * A triangle-and-bang would say "caution"; this says "this unit of work is
 * broken", which is the actual meaning.
 */
export function IncidentIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M8 4H20V16L16 20H4V8Z" />
      <path d="M13.5 5.5 10 11.5h4l-3.5 6" />
    </Mark>
  );
}

/**
 * recovery-engine — a fractured cell being closed by a return path.
 *
 * The arc sweeps back into the break: the engine is actively re-running the
 * broken unit, not merely reporting it.
 */
export function RecoveryEngineIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" />
      <path d="M20 4v4.5h-4.5" />
      <path d="M13 8.5 10.2 12.5h3.4L11 16.5" />
    </Mark>
  );
}

/**
 * blast-radius — concentric cells radiating from a fractured centre.
 *
 * The core is solid and broken; the rings are the cells it reaches. Each ring is
 * the same clipped-corner geometry, so the spread reads as "these units of work"
 * rather than as a generic ripple.
 */
export function BlastRadiusIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M7 2.5H21.5V14L17 18.5H2.5V7Z" strokeOpacity="0.4" />
      <path d="M9 6.5H17.5V12L14 15.5H5.5V10Z" strokeOpacity="0.7" />
      <path d="M11.5 10H15V13L13 15H9.5V12Z" fill="currentColor" stroke="none" />
    </Mark>
  );
}

/**
 * root-cause — many failures tracing back to one source.
 *
 * Two broken branches converge downward into a single solid cell. The direction
 * matters: the eye travels from symptoms to cause, which is the order an
 * operator actually works in.
 */
export function RootCauseIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M5 3.5v3.5c0 2.5 2.5 3 5 4.5" />
      <path d="M19 3.5v3.5c0 2.5-2.5 3-5 4.5" />
      <path d="M12 11.5v3" />
      <path d="M10 16H14.5V19L12.5 21H8V18Z" fill="currentColor" stroke="none" />
    </Mark>
  );
}
