import * as React from "react";
import { cn } from "~/lib/cn";
import type { IconComponent, IconWeight } from "~/components/icons/types";

/**
 * <Icon> — the only sanctioned way to render an icon.
 *
 * Wraps both Phosphor's set and the bespoke marks in src/components/icons, which
 * share an interface. It exists to enforce four things design §6 cares about and
 * that call sites otherwise get wrong.
 *
 * 1. SIZE comes from a token scale. No arbitrary px.
 * 2. WEIGHT is `regular` unless the element is active or filled. Never mix
 *    weights inside one hierarchy level.
 * 3. OPTICAL ALIGNMENT, not box alignment. See the note on ICON_NUDGE below.
 * 4. ACCESSIBILITY is not optional, and the type system enforces it: an icon is
 *    either decorative (and hidden from assistive tech) or it is interactive /
 *    meaningful (and must carry a label). There is no third state, and no way to
 *    render one without saying which it is.
 */

export const ICON_SIZE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
} as const;

export type IconSize = keyof typeof ICON_SIZE;

/**
 * Optical alignment.
 *
 * Icon glyphs are drawn on a square canvas, but text sits on a baseline with its
 * mass above it. Box-aligning the two leaves the icon looking high. Dropping it
 * by an em-relative fraction — not a fixed pixel — keeps the correction
 * proportional at every size in the scale, which a px nudge would not be.
 *
 * Applied via vertical-align for inline text runs; in a flex row the parent's
 * `items-center` governs and this is inert.
 */
const ICON_NUDGE = "align-[-0.125em]";

type BaseProps = {
  /** A component from ~/components/icons, or any Phosphor icon. */
  icon: IconComponent;
  size?: IconSize;
  /** `bold` is reserved for active and filled states. */
  weight?: IconWeight;
  className?: string;
};

type DecorativeProps = BaseProps & {
  /** The icon adds no information the surrounding text does not already carry. */
  decorative: true;
  label?: never;
};

type LabelledProps = BaseProps & {
  /** Announced to assistive technology. Required whenever the icon carries meaning. */
  label: string;
  decorative?: false;
};

export type IconProps = DecorativeProps | LabelledProps;

export function Icon({ icon: Glyph, size = "md", weight = "regular", className, ...rest }: IconProps) {
  const px = ICON_SIZE[size];
  const decorative = "decorative" in rest && rest.decorative === true;

  return (
    <Glyph
      size={px}
      weight={weight}
      className={cn("inline-block shrink-0", ICON_NUDGE, className)}
      // Decorative icons are removed from the accessibility tree entirely.
      // Labelled ones become an img-role node carrying the label, so a screen
      // reader announces the meaning rather than "graphic".
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : (rest as LabelledProps).label}
    />
  );
}
