import * as React from "react";
import { Mark } from "./_cell";
import type { IconComponentProps } from "../types";

/* ══════════════════════════════════════════════════════════════════════════════
   HUMAN — where a person is in the loop.

   These pair with ember, the colour of human involvement (§3.4). The shared form
   is the SHIELD-CELL: the standard cell with its lower edge drawn to a point —
   a cell that something has to pass through.
══════════════════════════════════════════════════════════════════════════════ */

/** The shield-cell: cell above, gate below. Shared by the three gate marks. */
const SHIELD = "M8 3H20V13L12 21L4 13V7Z";

/** approval-gate — the shield-cell barred, waiting on a decision. */
export function ApprovalGateIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d={SHIELD} />
      <path d="M4.5 11.5H19.5" />
      <path d="M12 8v7" />
    </Mark>
  );
}

/** gate-approved — passed. The check sits below the bar, on the far side. */
export function GateApprovedIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d={SHIELD} />
      <path d="M8.5 11.5 11.2 14.2 16 9.2" />
    </Mark>
  );
}

/** gate-rejected — refused. */
export function GateRejectedIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d={SHIELD} />
      <path d="M9.5 9.5 14.5 14.5" />
      <path d="M14.5 9.5 9.5 14.5" />
    </Mark>
  );
}

/**
 * sla-timer — a countdown ring around a gate.
 *
 * The heavy arc is time already spent; the gap is what remains. Deliberately not
 * an hourglass — this is a budget being consumed, not sand falling.
 */
export function SlaTimerIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <circle cx="12" cy="12.5" r="8" strokeOpacity="0.35" />
      <path d="M12 4.5a8 8 0 0 1 7.4 5" />
      <path d="M12 8.5v4l2.8 1.7" />
      <path d="M12 2.2v2.3" />
    </Mark>
  );
}

/** escalation — the decision handed up a level, then up again. */
export function EscalationIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M5.5 20 12 13.5 18.5 20" />
      <path d="M5.5 13 12 6.5 18.5 13" />
      <path d="M12 2.5V6" />
    </Mark>
  );
}
