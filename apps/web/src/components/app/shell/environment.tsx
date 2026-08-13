"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "~/lib/cn";
import { overlaySurface, overlayMotion } from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import type { EnvironmentId } from "~/mocks/shell";

/* ══════════════════════════════════════════════════════════════════════════════
   ENVIRONMENT — design §3.6.

   Expressed as a 2px rail along the top of the viewport plus a chip in the
   topbar. Not as a coloured page: the rail is peripheral so it never competes
   with content, but it is always in view, so an operator cannot forget which
   environment they are about to change.

   COLOUR IS NEVER THE ONLY SIGNAL. The chip carries a pattern too —
   production solid, staging diagonal hatch, development dashed — so the three
   are distinguishable in greyscale and to a colour-blind user. That is §14's
   "colour never the sole carrier of meaning" applied to the highest-consequence
   control in the product.
══════════════════════════════════════════════════════════════════════════════ */

export interface EnvironmentMeta {
  id: EnvironmentId;
  label: string;
  /** Semantic token driving both rail and chip. */
  colourVar: string;
  pattern: "solid" | "hatch" | "dash";
  description: string;
}

export const ENVIRONMENTS: EnvironmentMeta[] = [
  {
    id: "production", label: "Production", colourVar: "var(--env-production)", pattern: "solid",
    description: "Live customer traffic. Changes take effect immediately.",
  },
  {
    id: "staging", label: "Staging", colourVar: "var(--env-staging)", pattern: "hatch",
    description: "Pre-release verification against production-shaped data.",
  },
  {
    id: "development", label: "Development", colourVar: "var(--env-development)", pattern: "dash",
    description: "Scratch space. Data here is disposable.",
  },
];

export function environmentMeta(id: EnvironmentId): EnvironmentMeta {
  return ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0];
}

/**
 * The rail. Fixed to the top of the viewport, above everything, pointer-events
 * off so it can never intercept a click.
 */
export function EnvironmentRail({ environment }: { environment: EnvironmentId }) {
  const meta = environmentMeta(environment);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-tooltip h-[var(--env-rail)]"
      style={{
        background:
          meta.pattern === "solid"
            ? meta.colourVar
            : meta.pattern === "hatch"
              ? `repeating-linear-gradient(135deg, ${meta.colourVar} 0 6px, transparent 6px 12px)`
              : `repeating-linear-gradient(90deg, ${meta.colourVar} 0 8px, transparent 8px 16px)`,
      }}
    />
  );
}

/** The chip swatch — same pattern language as the rail, at chip scale. */
function PatternSwatch({ meta, className }: { meta: EnvironmentMeta; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2 shrink-0 rounded-[1px]", className)}
      style={{
        background:
          meta.pattern === "solid"
            ? meta.colourVar
            : meta.pattern === "hatch"
              ? `repeating-linear-gradient(135deg, ${meta.colourVar} 0 2px, transparent 2px 4px)`
              : `repeating-linear-gradient(90deg, ${meta.colourVar} 0 2px, transparent 2px 4px)`,
        outline: meta.pattern === "solid" ? "none" : `1px solid ${meta.colourVar}`,
      }}
    />
  );
}

export interface EnvironmentSwitcherProps {
  environment: EnvironmentId;
  onEnvironmentChange: (env: EnvironmentId) => void;
  /** Collapse to the swatch only, for narrow viewports. */
  compact?: boolean;
}

export function EnvironmentSwitcher({
  environment, onEnvironmentChange, compact = false,
}: EnvironmentSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState<EnvironmentId | null>(null);
  const current = environmentMeta(environment);

  const choose = (next: EnvironmentId) => {
    if (next === environment) { setOpen(false); return; }
    // Moving INTO production is the only direction that can break customers,
    // so it is the only one that asks. Leaving production is always allowed.
    if (next === "production") { setConfirming(next); return; }
    onEnvironmentChange(next);
    setOpen(false);
  };

  const confirm = () => {
    if (confirming) onEnvironmentChange(confirming);
    setConfirming(null);
    setOpen(false);
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) setConfirming(null); }}
    >
      <PopoverPrimitive.Trigger
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-sm border px-2",
          "font-ui text-caption text-fg-secondary",
          "bg-surface-raised border-default",
          "transition-colors duration-fast outline-none",
          "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
        )}
        aria-label={`Environment: ${current.label}. Change environment.`}
      >
        <PatternSwatch meta={current} />
        {compact ? null : <span>{current.label}</span>}
        <svg viewBox="0 0 16 16" className="size-3 opacity-60" fill="none" aria-hidden="true">
          <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className={cn(overlaySurface, overlayMotion, "z-popover w-72 p-1")}
        >
          {confirming ? (
            <div className="p-2">
              <Text variant="heading-sm" tone="max" className="mb-1">Switch to production?</Text>
              <Text variant="body-sm" tone="secondary" className="mb-3 block">
                Actions you take next affect live customer traffic. Runs you trigger will bill to the
                production budget and cannot be undone.
              </Text>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>Stay in {current.label.toLowerCase()}</Button>
                <Button size="sm" variant="primary" onClick={confirm}>Switch to production</Button>
              </div>
            </div>
          ) : (
            <div role="radiogroup" aria-label="Environment">
              {ENVIRONMENTS.map((env) => {
                const active = env.id === environment;
                return (
                  <button
                    key={env.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => choose(env.id)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-xs px-2 py-1.5 text-left",
                      "transition-colors duration-instant outline-none",
                      "hover:bg-surface-hover focus-visible:focus-ring",
                      active && "bg-surface-hover",
                    )}
                  >
                    <PatternSwatch meta={env} className="mt-1" />
                    <span className="min-w-0 flex-1">
                      <span className="font-ui text-body-sm text-fg-primary flex items-center gap-2">
                        {env.label}
                        {env.id === "production" ? (
                          <span className="font-ui text-caption text-fg-muted">requires confirmation</span>
                        ) : null}
                      </span>
                      <span className="font-ui text-caption text-fg-muted block">{env.description}</span>
                    </span>
                    {active ? (
                      <svg viewBox="0 0 16 16" className="text-accent mt-1 size-3.5 shrink-0" fill="none" aria-hidden="true">
                        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
