import * as React from "react";
import { cn } from "~/lib/cn";

/**
 * The workspace mark — a cell containing the workspace initial.
 *
 * Deliberately NOT a coloured circle with a random hue per workspace. That
 * pattern conflicts with the governing rule: an operator scanning for anomalies
 * must not have arbitrary saturated colour in the chrome competing with status.
 * The mark uses the clipped-corner cell from the icon set and the brand tint, so
 * every workspace looks like part of the same product and nothing shouts.
 */
export function PatternedInitial({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "W";
  const px = size === "sm" ? 20 : 24;

  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center",
        "bg-accent-subtle text-accent",
        className,
      )}
      style={{
        width: px,
        height: px,
        // The cell: clipped top-left and bottom-right, matching the icon set.
        clipPath: "polygon(25% 0, 100% 0, 100% 75%, 75% 100%, 0 100%, 0 25%)",
      }}
      aria-hidden="true"
    >
      <span className={cn("font-display font-bold", size === "sm" ? "text-[10px]" : "text-caption")}>
        {initial}
      </span>
    </span>
  );
}
