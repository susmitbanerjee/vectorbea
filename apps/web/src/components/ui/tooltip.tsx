"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "~/lib/cn";

/**
 * <Tooltip> — a label for a control whose meaning is not already on screen.
 *
 * Not for prose. If the content is a sentence the user needs, it belongs in the
 * interface, not behind a hover: tooltips are invisible to touch users and to
 * anyone scanning rather than pointing.
 *
 * `TooltipProvider` is mounted once at the shell root so the whole app shares
 * one hover-delay budget — moving between adjacent icon buttons then shows the
 * second tooltip instantly instead of re-waiting, which is what makes a
 * collapsed sidebar usable.
 */

export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  /** Extra hint rendered on a second line, e.g. a keyboard shortcut. */
  shortcut?: React.ReactNode;
  /** Skip rendering entirely — for a sidebar that is expanded. */
  disabled?: boolean;
  sideOffset?: number;
}

export function Tooltip({
  content, children, side = "top", shortcut, disabled = false, sideOffset = 6,
}: TooltipProps) {
  if (disabled) return <>{children}</>;
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={sideOffset}
          className={cn(
            "motion-overlay z-tooltip",
            "bg-surface-overlay border-subtle shadow-2 rounded-sm border",
            "font-ui text-caption text-fg-primary px-2 py-1",
            "flex items-center gap-2",
          )}
        >
          {content}
          {shortcut ? <span className="text-fg-muted">{shortcut}</span> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
