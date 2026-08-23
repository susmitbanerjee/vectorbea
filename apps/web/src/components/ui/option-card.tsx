"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Icon, type IconSize } from "~/components/ui/icon";
import type { IconComponent } from "~/components/icons/types";

/* ══════════════════════════════════════════════════════════════════════════════
   <OptionCards> — a radio group that reads as a decision, not as a form control.

   Picking a tool adapter or a trigger is a branch in the workflow, not a
   preference: the choice changes which fields exist two steps later. A native
   <select> hides the alternatives behind a click and gives each one four words
   of context at most; a row of cards puts the trade-off on screen at the moment
   it is being made.

   IT IS A REAL RADIO GROUP UNDERNEATH. Roving focus, arrow-key traversal and
   the single tab stop come from Radix, so keyboard behaviour matches every
   other radio in the product rather than being re-implemented per screen with
   `<div onClick>`.

   SELECTION IS BRAND, NOT STATUS (rule 11). The selected card is iris-tinted
   with an iris border. Nothing here ever goes green: a chosen option is not a
   healthy one, and the two must not learn to look alike.

   MOTION IS BORDER AND BACKGROUND ONLY. No lift, no scale. A grid of cards that
   each rise 2px on hover turns a decision surface into a trampoline, and design
   §7 deletes motion that decorates.
══════════════════════════════════════════════════════════════════════════════ */

export interface OptionCardItem<T extends string = string> {
  value: T;
  label: string;
  /** One line. What choosing this actually does. */
  description?: React.ReactNode;
  icon?: IconComponent;
  /** Right-aligned marker — "Recommended", "Requires a connection". */
  badge?: React.ReactNode;
  disabled?: boolean;
  /** Shown under the description when disabled, to say why. */
  disabledReason?: React.ReactNode;
}

export interface OptionCardsProps<T extends string = string> {
  options: OptionCardItem<T>[];
  value: T | null;
  onValueChange: (value: T) => void;
  /** Accessible name for the group. Required — this replaces a <legend>. */
  label: string;
  columns?: 1 | 2 | 3;
  /** `compact` drops the icon well and tightens the box for long lists. */
  density?: "default" | "compact";
  disabled?: boolean;
  className?: string;
}

const COLUMNS = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
} as const;

export function OptionCards<T extends string = string>({
  options,
  value,
  onValueChange,
  label,
  columns = 2,
  density = "default",
  disabled,
  className,
}: OptionCardsProps<T>) {
  const iconSize: IconSize = density === "compact" ? "sm" : "md";

  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value ?? undefined}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
      className={cn("grid gap-2", COLUMNS[columns], className)}
    >
      {options.map((option) => {
        const selected = value === option.value;
        const off = Boolean(disabled ?? option.disabled);

        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={off}
            className={cn(
              "group relative flex items-start gap-2.5 rounded-md border text-left",
              density === "compact" ? "px-3 py-2.5" : "px-3.5 py-3",
              "transition-colors duration-fast ease-standard",
              "outline-none focus-visible:focus-ring",
              off
                ? "border-subtle bg-surface-sunken cursor-not-allowed opacity-55"
                : selected
                  ? "border-accent-border bg-accent-subtle cursor-pointer"
                  : "border-subtle bg-surface-raised hover:border-strong hover:bg-surface-hover cursor-pointer",
            )}
          >
            {option.icon && density !== "compact" ? (
              <span
                aria-hidden="true"
                className={cn(
                  "mt-px flex size-7 shrink-0 items-center justify-center rounded-sm border",
                  "transition-colors duration-fast",
                  selected
                    ? "border-accent-border bg-surface-base text-accent"
                    : "border-subtle bg-surface-sunken text-fg-muted",
                )}
              >
                <Icon icon={option.icon} size={iconSize} weight={selected ? "bold" : "regular"} decorative />
              </span>
            ) : null}

            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <Text
                  variant="body-sm"
                  tone={selected ? "accent" : off ? "muted" : "primary"}
                  className="min-w-0 truncate font-medium"
                >
                  {option.label}
                </Text>
                {option.badge ? <span className="shrink-0">{option.badge}</span> : null}
              </span>
              {option.description ? (
                <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">
                  {option.description}
                </Text>
              ) : null}
              {off && option.disabledReason ? (
                <Text variant="caption" tone="muted" className="mt-1 block leading-snug italic">
                  {option.disabledReason}
                </Text>
              ) : null}
            </span>

            {/* The selection mark. Occupies its box whether or not it is lit, so
                selecting a card cannot shift the text beside it. */}
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                "transition-colors duration-fast",
                selected ? "border-accent bg-accent" : "border-default bg-transparent",
              )}
            >
              <span
                className={cn(
                  "bg-fg-on-accent size-1.5 rounded-full transition-transform duration-fast ease-standard",
                  selected ? "scale-100" : "scale-0",
                )}
              />
            </span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}

/* ── Segmented control ────────────────────────────────────────────────────── */

export interface SegmentOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional dot colour class — used by the risk tiers. */
  markerClassName?: string;
}

/**
 * For a small ordered set where the ORDER is the information — risk tiers,
 * lifecycle states. A dropdown would hide the scale; four cards would give a
 * one-word answer far more room than it is worth.
 */
export function Segmented<T extends string = string>({
  options,
  value,
  onValueChange,
  label,
  disabled,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
      orientation="horizontal"
      className={cn(
        "border-subtle bg-surface-sunken inline-flex w-full gap-0.5 rounded-sm border p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <RadioGroupPrimitive.Item
            key={option.value}
            value={option.value}
            className={cn(
              "font-ui text-body-sm flex flex-1 items-center justify-center gap-1.5 rounded-xs px-2 py-1",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "bg-surface-raised text-fg-max shadow-1"
                : "text-fg-muted hover:text-fg-primary cursor-pointer",
            )}
          >
            {option.markerClassName ? (
              <span
                aria-hidden="true"
                className={cn("size-1.5 shrink-0 rounded-full", option.markerClassName)}
              />
            ) : null}
            <span className="truncate">{option.label}</span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
