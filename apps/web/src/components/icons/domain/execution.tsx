import * as React from "react";
import { Mark } from "./_cell";
import type { IconComponentProps } from "../types";

/* ══════════════════════════════════════════════════════════════════════════════
   EXECUTION — what a step actually does, and what it costs.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * tool-call — a keyed slot.
 *
 * A cell with a keyway cut into it: the tool is the thing that fits. Not a
 * wrench — a wrench says "settings" in every other product on the operator's
 * screen.
 */
export function ToolCallIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M8 4H20V16L16 20H4V8Z" />
      <circle cx="12" cy="10.5" r="2.2" />
      <path d="M12 12.7V16.5" />
      <path d="M10.4 14.8h3.2" />
    </Mark>
  );
}

/**
 * agent-brain — a cell within a cell, wired outward.
 *
 * Reasoning is drawn as nesting rather than as a head or a lightbulb: an agent
 * is a cell that contains its own smaller loop, with grants reaching out to the
 * tools it is allowed to call.
 */
export function AgentBrainIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M8.5 5.5H18.5V15L15.5 18H5.5V8.5Z" />
      <path d="M11 9.5H15V12.5L13.5 14H10V10.5Z" fill="currentColor" stroke="none" />
      <path d="M12 5.5V2.5" />
      <path d="M18.5 12H21.5" />
      <path d="M2.5 11.5H5.5" />
      <path d="M12 18v3.5" />
    </Mark>
  );
}

/**
 * byok-key — bring your own key.
 *
 * The bow of the key is a cell: the credential is itself a durable object the
 * workspace holds, not a generic padlock.
 */
export function ByokKeyIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M7.5 3.5H14V10L11.5 12.5H5V6Z" />
      <path d="M11.5 12.5 20 21" />
      <path d="M15.5 16.5 13.5 18.5" />
      <path d="M18 19 16 21" />
    </Mark>
  );
}

/**
 * token-meter — consumption against a ceiling.
 *
 * A gauge sweep with the needle past the midpoint and the ceiling ticked at both
 * ends. Reads as a measurement, not as a speedometer.
 */
export function TokenMeterIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M3.5 17.5a8.5 8.5 0 0 1 17 0" />
      <path d="M12 17.5 16.5 11" />
      <circle cx="12" cy="17.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M3.5 17.5H5.5" />
      <path d="M18.5 17.5h2" />
    </Mark>
  );
}

/**
 * budget-burn — spend accelerating against remaining budget.
 *
 * Bars falling left to right with the trend arrow driving through them: this is
 * a burn-down, so the information is the slope, not the height.
 */
export function BudgetBurnIcon({ size, weight, ...rest }: IconComponentProps) {
  return (
    <Mark size={size} weight={weight} {...rest}>
      <path d="M4 8.5V18" />
      <path d="M10 11.5V18" />
      <path d="M16 14.5V18" />
      <path d="M2.5 20.5h19" />
      <path d="M3.5 4.5 21 12" />
      <path d="M21 7.5V12h-4.5" />
    </Mark>
  );
}
