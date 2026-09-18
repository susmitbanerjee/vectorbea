import * as React from "react";
import { cn } from "~/lib/cn";

/* ══════════════════════════════════════════════════════════════════════════════
   PLAN TIER — the ring on an avatar, and the chip beside it.

   ── WHAT THIS IS ALLOWED TO CLAIM ───────────────────────────────────────────
   A plan belongs to a WORKSPACE's billing account, never to a person
   (docs/PLANS-AND-ENTITLEMENTS.md, invariant 11). A Pro subscriber acting
   inside a Free workspace gets Free limits at every enforcement point, so a
   ring that read "Pro" on their avatar there would promise something the API
   will refuse ten seconds later — and they would report it as a bug in the API.

   So the ring says: THE WORKSPACE YOU ARE IN is on this plan. It is drawn on
   the avatar because that is where the account affordance lives, not because
   the person is the subject. Nothing here takes a user, and it must stay that
   way.

   ── FREE DRAWS NOTHING, AND THAT IS THE DESIGN ──────────────────────────────
   `planTier("free")` returns null and both components render the bare child.
   A "Free" chip on every unpaid account would make the paid ones ordinary; the
   absence is what gives the presence its meaning. Unknown draws nothing too —
   see `planTier` below.

   ── WHY OUTLINE AND NOT RING ────────────────────────────────────────────────
   `outline` is painted outside the border box WITHOUT reserving space, so a
   tier's ring cannot change the height of the row it sits in. With `ring` (a
   box-shadow) plus the gap that makes it read as a ring rather than a border,
   the sidebar's account row grew seven pixels taller than Docs and Theme above
   it — for paying customers only, which is the wrong half of the userbase to
   show a lumpy sidebar to.
══════════════════════════════════════════════════════════════════════════════ */

export type PlanTierId = "pro" | "team" | "enterprise";

export interface PlanTier {
  id: PlanTierId;
  /**
   * The word, when the server has not given us one.
   *
   * Prefer the plan's own `name` from `/api/entitlements` wherever you have it.
   * Plans are DATA — an operator can rename one without a deploy — so this is a
   * fallback for the window before the request resolves, not a label table.
   */
  fallbackLabel: string;
  /** Outline colour + width for the avatar. */
  ring: string;
  /** Fill, label and outline for the chip. */
  chip: string;
}

const TIERS: Record<PlanTierId, PlanTier> = {
  pro: {
    id: "pro",
    fallbackLabel: "Pro",
    ring: "outline-2 outline-plan-pro-ink",
    chip: "border-plan-pro-ink bg-plan-pro-chip text-plan-pro-chip-fg",
  },
  team: {
    id: "team",
    fallbackLabel: "Team",
    ring: "outline-2 outline-plan-team-ink",
    chip: "border-plan-team-ink bg-plan-team-chip text-plan-team-chip-fg",
  },
  /* The solid inversion. Every other chip in the product is a tint with a
     contrasting outline; this one is ink filled with the surface colour, which
     makes it the loudest chip we draw. That is deliberate — gold escalates to
     the black card, and on the dark theme the black card is a white one. */
  enterprise: {
    id: "enterprise",
    fallbackLabel: "Enterprise",
    ring: "outline-2 outline-plan-enterprise-ink",
    chip: "border-plan-enterprise-ink bg-plan-enterprise-chip text-plan-enterprise-chip-fg",
  },
};

/**
 * The treatment for a plan code, or null for no treatment at all.
 *
 * Null covers three cases that must all draw nothing: Free, an unresolved
 * answer, and a plan code this build has never heard of. The last one matters —
 * plan codes are rows in a table and an operator can add one — and drawing
 * nothing is the right failure: a tier we cannot name is a claim we cannot
 * make, and inventing a ring for it would tell a customer they bought something
 * this UI is guessing at.
 */
export function planTier(planCode: string | null | undefined): PlanTier | null {
  if (!planCode) return null;
  return TIERS[planCode.toLowerCase() as PlanTierId] ?? null;
}

export interface PlanRingProps {
  tier: PlanTier | null;
  /**
   * Gap between the avatar and its ring. `lg` is for avatars above ~32px, where
   * a two-pixel gap closes up and the ring reads as a border.
   */
  offset?: "sm" | "lg";
  className?: string;
  children: React.ReactNode;
}

/**
 * Wraps an avatar in its tier's ring. Renders the child untouched when there is
 * no tier, so every call site can mount this unconditionally.
 */
export function PlanRing({ tier, offset = "sm", className, children }: PlanRingProps) {
  if (!tier) return <>{children}</>;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-full",
        tier.ring,
        offset === "lg" ? "outline-offset-4" : "outline-offset-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface PlanChipProps {
  tier: PlanTier | null;
  /** The plan's name as the API gave it. Falls back to the tier's own word. */
  name?: string | null;
  className?: string;
}

/** The word beside the ring. Sentence case, because the product is. */
export function PlanChip({ tier, name, className }: PlanChipProps) {
  if (!tier) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-1.5",
        "font-ui text-label leading-[1.5]",
        tier.chip,
        className,
      )}
    >
      {name || tier.fallbackLabel}
    </span>
  );
}
