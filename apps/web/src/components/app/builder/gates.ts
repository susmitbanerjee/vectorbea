import { isEnabled, describeFlag, type FlagName } from "~/lib/flags";
import { ENTITLEMENT, type Entitlements } from "~/lib/entitlements/use-entitlements";
import type { NodeKind } from "~/lib/architect/blueprint";

/* ══════════════════════════════════════════════════════════════════════════════
   WHY A CONTROL IS UNAVAILABLE — and what to do about it.

   ── VISIBLE AND DISABLED, NEVER HIDDEN ──────────────────────────────────────
   A hidden feature is indistinguishable from a feature the product does not
   have. Somebody evaluating this platform against another one cannot buy what
   they cannot see, and somebody already paying cannot tell whether the thing
   they read about is missing, broken, or simply not theirs yet.

   So nothing is removed from the palette. Everything is offered, and anything
   unavailable carries the sentence that says why and the one action that would
   change it.

   ── TWO REASONS, AND THEY ARE NOT THE SAME SENTENCE ─────────────────────────
   A control can be unavailable for reasons that look identical in a `disabled`
   prop and are completely different to the person reading:

     PLAN     the workspace's billing account does not include it. The action is
              an upgrade, and the sentence names the plan that has it. This is
              recoverable by the reader, today, with a credit card.

     RUNTIME  the deployment has the behaviour switched off. No amount of money
              changes it; the action is to ask an operator. Selling somebody an
              upgrade to a feature that is flagged off in their region would be
              the worst outcome this file exists to prevent.

   Collapsing them into "unavailable" produces a support ticket either way. Which
   one it is decides whether the answer is "here is the upgrade link" or "we have
   not turned that on yet, and here is when".
══════════════════════════════════════════════════════════════════════════════ */

export type GateReason = "plan" | "runtime";

export interface Gate {
  available: boolean;
  reason: GateReason | null;
  /** One sentence, sentence case, stating what is unavailable and why. */
  message: string;
  /** The single action that changes the answer. */
  action: string;
  /** Where the action goes, when it is a link. Null when it is a conversation. */
  href: string | null;
}

const OPEN: Gate = { available: true, reason: null, message: "", action: "", href: null };

function planGate(plan: Entitlements | undefined, key: string, what: string): Gate | null {
  // Unresolved is permissive. See the note on `useEntitlements`: gating on an
  // answer we do not have takes the product away from people whose plan allows
  // it, on exactly the deploys where the two services are skewed.
  if (!plan || plan.unknown) return null;
  if (plan.has(key)) return null;

  const granting = plan.planGranting(key) ?? plan.upgradeTo;
  const on = plan.planName ? `The ${plan.planName} plan` : "This workspace's plan";
  return {
    available: false,
    reason: "plan",
    message: granting
      ? `${on} does not include ${what}. ${granting.name} does.`
      : `${on} does not include ${what}.`,
    action: granting ? `Upgrade to ${granting.name}` : "Talk to us about a plan that includes it",
    href: plan.upgradeUrl ?? (granting ? "/settings/billing" : null),
  };
}

function runtimeGate(flag: FlagName, what: string): Gate | null {
  if (isEnabled(flag)) return null;
  return {
    available: false,
    reason: "runtime",
    message: `${what} is not switched on in this deployment.`,
    /* Named rather than vague: `describeFlag(...).blockedBy` carries the actual
       environment variable, and an operator reading a screenshot of this can act
       on it without opening the codebase. */
    action: describeFlag(flag).blockedBy,
    href: null,
  };
}

/**
 * Can this node kind be added and run here?
 *
 * ── RUNTIME IS CHECKED FIRST, AND THAT ORDER IS THE POINT ───────────────────
 * A workspace can be on a plan that does not include teams AND in a deployment
 * where teams are switched off. Reporting the plan reason there would offer an
 * upgrade that buys nothing, because the executor would still refuse the node.
 * The honest answer, and the one that does not take somebody's money for
 * something they cannot use, is the runtime one.
 */
export function gateForKind(kind: NodeKind, plan?: Entitlements): Gate {
  if (kind !== "agent_team") return OPEN;
  return (
    runtimeGate("agentTeams", "Agent teams")
    ?? planGate(plan, ENTITLEMENT.TEAMS, "agent teams")
    ?? OPEN
  );
}

/** The gate on per-member delegation, which is a feature before it is a depth. */
export function gateForDelegation(plan?: Entitlements): Gate {
  return (
    runtimeGate("agentDelegation", "Delegation between team members")
    ?? planGate(plan, ENTITLEMENT.DELEGATION, "delegation")
    ?? OPEN
  );
}

/** The gate on exporting spans to a customer's own collector. */
export function gateForOtelExport(plan?: Entitlements): Gate {
  return (
    runtimeGate("otelExport", "OpenTelemetry export")
    ?? planGate(plan, ENTITLEMENT.OTEL_EXPORT, "OpenTelemetry export")
    ?? OPEN
  );
}
