"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "~/lib/cn";
import { controlBase, controlSize, useFieldControl, type ControlSize } from "./field";
import { Checkbox } from "./choice";

/**
 * Shared surface for every floating panel in the system — Select, MultiSelect,
 * Combobox, Popover, DropdownMenu, ContextMenu.
 *
 * Overlay surface (one step above raised), 1px border, radius `md`, and the
 * shadow-2 elevation token. Defined once so a menu can never drift from a
 * popover, which is how design systems start to look assembled rather than
 * designed.
 */
export const overlaySurface = [
  "bg-surface-overlay border-subtle border rounded-md shadow-2",
  "z-dropdown overflow-hidden",
].join(" ");

/**
 * Entrance and exit. Defined in src/styles/tokens/motion.css so the durations
 * and easings are ours, not tailwindcss-animate's defaults.
 */
export const overlayMotion = "motion-overlay";

export const menuItem = [
  "relative flex cursor-pointer select-none items-center gap-2 rounded-xs",
  "px-2 py-1.5 font-ui text-body-sm text-fg-secondary outline-none",
  "transition-colors duration-instant",
  "data-[highlighted]:bg-surface-hover data-[highlighted]:text-fg-primary",
  "data-[state=checked]:text-fg-primary",
  "data-[disabled]:pointer-events-none data-[disabled]:text-fg-disabled",
].join(" ");

/* ── Select ─────────────────────────────────────────────────────────────────
   Single choice from a known, short list. Radix Select, fully restyled: no
   default chevron, our own overlay surface, and a check on the RIGHT so the
   option labels stay left-aligned on a common axis. */

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectPrimitive.SelectProps, "children"> {
  options: SelectOption[];
  placeholder?: string;
  size?: ControlSize;
  className?: string;
  /** Announced when no visible label is associated. */
  "aria-label"?: string;
}

export const Select = React.forwardRef<React.ElementRef<typeof SelectPrimitive.Trigger>, SelectProps>(
  function Select({ options, placeholder = "Select…", size = "md", className, disabled, ...props }, ref) {
    const field = useFieldControl();
    return (
      <SelectPrimitive.Root disabled={disabled ?? field.disabled} {...props}>
        <SelectPrimitive.Trigger
          ref={ref}
          id={field.id}
          aria-invalid={field["aria-invalid"]}
          aria-describedby={field["aria-describedby"]}
          className={cn(
            controlBase, controlSize[size],
            "flex items-center justify-between gap-2 text-left",
            "data-[placeholder]:text-fg-muted",
            className,
          )}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon asChild>
            <Chevron />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>

        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={4}
            className={cn(overlaySurface, overlayMotion, "min-w-[var(--radix-select-trigger-width)]")}
          >
            <SelectPrimitive.Viewport className="max-h-72 p-1">
              {options.map((o) => (
                <SelectPrimitive.Item key={o.value} value={o.value} disabled={o.disabled} className={menuItem}>
                  <span className="flex min-w-0 flex-col">
                    <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                    {o.description ? (
                      <span className="text-caption text-fg-muted">{o.description}</span>
                    ) : null}
                  </span>
                  <SelectPrimitive.ItemIndicator className="text-accent ml-auto">
                    <Tick />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    );
  },
);

/* ── MultiSelect ────────────────────────────────────────────────────────────
   Several choices from a known list. Built on Popover rather than Select
   because a native-semantics listbox closes on choose, and multi-select must
   stay open. The trigger summarises rather than listing every choice — "4
   selected" is scannable in a table cell where four chips are not. */

export interface MultiSelectProps {
  options: SelectOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  size?: ControlSize;
  className?: string;
  disabled?: boolean;
  /** Label used in the summary: "3 regions selected". */
  noun?: string;
}

export const MultiSelect = React.forwardRef<HTMLButtonElement, MultiSelectProps>(function MultiSelect(
  { options, value, onValueChange, placeholder = "Select…", size = "md", className, disabled, noun = "selected" },
  ref,
) {
  const field = useFieldControl();
  const toggle = (v: string) =>
    onValueChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? `1 ${noun}`)
        : `${value.length} ${noun}`;

  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        ref={ref}
        id={field.id}
        disabled={disabled ?? field.disabled}
        aria-invalid={field["aria-invalid"]}
        aria-describedby={field["aria-describedby"]}
        className={cn(
          controlBase, controlSize[size],
          "flex items-center justify-between gap-2 text-left",
          value.length === 0 && "text-fg-muted",
          className,
        )}
      >
        <span className="truncate">{summary}</span>
        <Chevron />
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className={cn(overlaySurface, overlayMotion, "w-[var(--radix-popover-trigger-width)] p-1")}
        >
          <div className="max-h-72 overflow-y-auto" role="group">
            {options.map((o) => (
              <div
                key={o.value}
                className={cn(menuItem, "cursor-pointer", o.disabled && "pointer-events-none opacity-50")}
                onClick={() => !o.disabled && toggle(o.value)}
              >
                <Checkbox
                  checked={value.includes(o.value)}
                  disabled={o.disabled}
                  tabIndex={-1}
                  aria-label={o.label}
                  onCheckedChange={() => toggle(o.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{o.label}</span>
                  {o.description ? <span className="text-caption text-fg-muted">{o.description}</span> : null}
                </span>
              </div>
            ))}
          </div>

          {value.length > 0 ? (
            <div className="border-subtle mt-1 border-t pt-1">
              <button
                type="button"
                onClick={() => onValueChange([])}
                className={cn(menuItem, "w-full justify-center")}
              >
                Clear {value.length} {noun}
              </button>
            </div>
          ) : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
});

export function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"
      className={cn("text-fg-muted size-3.5 shrink-0", className)}>
      <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Tick({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"
      className={cn("size-3.5 shrink-0", className)}>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
