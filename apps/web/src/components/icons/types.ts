import type * as React from "react";

/**
 * The interface every icon in the system implements — bespoke domain marks,
 * node marks, and (by coincidence of API) Phosphor's icons too. That shared
 * shape is what lets <Icon> wrap all of them uniformly.
 */
export type IconWeight = "regular" | "bold";

export interface IconComponentProps
  extends Omit<React.SVGProps<SVGSVGElement>, "ref" | "weight"> {
  /** Rendered px. <Icon> supplies this from the size token scale. */
  size?: number | string;
  /** `bold` is reserved for active and filled states (design §6). */
  weight?: IconWeight;
}

export type IconComponent = React.FC<IconComponentProps>;

/** Stroke width for each weight, normalised to a 1.5px optical stroke. */
export const STROKE: Record<IconWeight, number> = {
  regular: 1.5,
  bold: 2.25,
};
