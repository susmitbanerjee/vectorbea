"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "~/lib/cn";
import { useFieldControl } from "./field";

/* ══════════════════════════════════════════════════════════════════════════════
   CHOICE CONTROLS — Checkbox, Radio, Switch.

   All three share one rule the default shadcn set gets wrong: the CONTROL and
   its LABEL are one hit target, and the label is not an afterthought bolted on
   by the call site. Each accepts children and renders the pair, so a mis-wired
   htmlFor is impossible.

   Checked state is the brand tint plus a glyph. Never colour alone (§14).
══════════════════════════════════════════════════════════════════════════════ */

const box = [
  "peer shrink-0 rounded-xs border border-strong bg-surface-sunken",
  // Radix renders these as <button>, and Tailwind v4's preflight sets
  // `cursor: default` on buttons. The wrapping label already says pointer, but
  // the box is the thing people aim at, and a bare Checkbox has no label.
  "cursor-pointer",
  "transition-[background-color,border-color,box-shadow] duration-fast ease-standard",
  "outline-none",
  "hover:not-disabled:border-accent",
  "focus-visible:focus-ring",
  "data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-fg-on-accent",
  "data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:text-fg-on-accent",
  "disabled:cursor-not-allowed disabled:opacity-50",
  "aria-[invalid=true]:border-status-failed",
].join(" ");

/** Wraps a control and its label into a single clickable row. */
function ChoiceRow({
  control, children, description, disabled, className,
}: {
  control: React.ReactNode;
  children?: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  if (!children && !description) return <>{control}</>;
  return (
    <div className={cn("flex items-start gap-2", className)}>
      {control}
      <div className="grid gap-0.5 leading-none">
        <span
          className={cn(
            "font-ui text-body-sm text-fg-primary cursor-pointer select-none",
            disabled && "text-fg-disabled cursor-not-allowed",
          )}
        >
          {children}
        </span>
        {description ? (
          <span className={cn("font-ui text-caption text-fg-muted", disabled && "text-fg-disabled")}>
            {description}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ── Checkbox ───────────────────────────────────────────────────────────── */

export interface CheckboxProps
  extends Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, "children"> {
  children?: React.ReactNode;
  description?: React.ReactNode;
}

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(function Checkbox({ className, children, description, disabled, id, ...props }, ref) {
  const field = useFieldControl();
  const reactId = React.useId();
  const controlId = id ?? field.id ?? `checkbox-${reactId}`;

  const control = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={controlId}
      disabled={disabled ?? field.disabled}
      className={cn(box, "mt-0.5 size-4", className)}
      aria-invalid={field["aria-invalid"]}
      aria-describedby={field["aria-describedby"]}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center text-current">
        {props.checked === "indeterminate" ? <DashGlyph /> : <CheckGlyph />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!children && !description) return control;

  return (
    <label htmlFor={controlId} className="contents">
      <ChoiceRow control={control} description={description} disabled={disabled ?? field.disabled}>
        {children}
      </ChoiceRow>
    </label>
  );
});

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden="true" focusable="false">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DashGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" fill="none" aria-hidden="true" focusable="false">
      <path d="M4 8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* ── Radio ──────────────────────────────────────────────────────────────── */

export const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-2", className)} {...props} />;
});

export interface RadioProps
  extends Omit<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>, "children"> {
  children?: React.ReactNode;
  description?: React.ReactNode;
}

export const Radio = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  RadioProps
>(function Radio({ className, children, description, disabled, id, ...props }, ref) {
  const reactId = React.useId();
  const controlId = id ?? `radio-${reactId}`;

  const control = (
    <RadioGroupPrimitive.Item
      ref={ref}
      id={controlId}
      disabled={disabled}
      className={cn(box, "mt-0.5 size-4 rounded-full", className)}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="grid place-items-center">
        <span className="bg-fg-on-accent size-1.5 rounded-full" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );

  if (!children && !description) return control;

  return (
    <label htmlFor={controlId} className="contents">
      <ChoiceRow control={control} description={description} disabled={disabled}>
        {children}
      </ChoiceRow>
    </label>
  );
});

/* ── Switch ─────────────────────────────────────────────────────────────────
   For state that applies IMMEDIATELY. If the change needs saving, it is a
   Checkbox — a switch that requires a Save button is a lie about its own
   affordance, and operators learn to distrust it. */

export interface SwitchProps
  extends Omit<React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>, "children"> {
  children?: React.ReactNode;
  description?: React.ReactNode;
}

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(function Switch({ className, children, description, disabled, id, ...props }, ref) {
  const field = useFieldControl();
  const reactId = React.useId();
  const controlId = id ?? field.id ?? `switch-${reactId}`;

  const control = (
    <SwitchPrimitive.Root
      ref={ref}
      id={controlId}
      disabled={disabled ?? field.disabled}
      className={cn(
        "peer inline-flex h-4.5 w-8 shrink-0 items-center rounded-full border p-px",
        "cursor-pointer",
        "transition-[background-color,border-color,box-shadow] duration-fast ease-standard",
        "outline-none focus-visible:focus-ring",
        "bg-surface-active border-strong",
        "data-[state=checked]:bg-accent data-[state=checked]:border-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-3.5 rounded-full",
          // The thumb cannot use fg-max: that token inverts with the theme, so
          // the switch ends up with a white thumb on dark and a BLACK one on
          // light. Off is a neutral grey (legible on both unchecked tracks);
          // on is fg-on-accent, which is defined precisely as "ink that reads
          // against the brand fill" in each theme.
          "bg-fg-muted data-[state=checked]:bg-fg-on-accent",
          // Transform only — never left/width (rule 9).
          "transition-[transform,background-color] duration-fast ease-standard",
          "translate-x-0 data-[state=checked]:translate-x-3.5",
        )}
      />
    </SwitchPrimitive.Root>
  );

  if (!children && !description) return control;

  return (
    <label htmlFor={controlId} className="contents">
      <ChoiceRow control={control} description={description} disabled={disabled ?? field.disabled}>
        {children}
      </ChoiceRow>
    </label>
  );
});
