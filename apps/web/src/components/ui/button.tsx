"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "~/lib/cn";
import { Spinner } from "./spinner";

/* ══════════════════════════════════════════════════════════════════════════════
   ACTIONS

   Deliberately NOT the shadcn silhouette. Differences that matter:

   - Radius is `sm` (6px) from the six-step scale, not the default `lg`. Buttons
     in a dense operator UI sit next to inputs and table rows; a 6px corner reads
     as an instrument control, a 12px one reads as a marketing CTA.
   - Elevation comes from a 1px border at a chosen colour step, never a drop
     shadow (design §8: "emphasis comes from colour step, never width").
   - Press is a 1px downward translate, not a scale. Scaling text at 13px makes
     it shimmer; translating keeps the glyphs on the pixel grid.
   - The focus ring is the two-stop --shadow-focus token: a surface-coloured
     spacer then iris. It survives on any surface, including a selected row.
   - `primary` is iris. It is the brand, and per the governing rule it is never a
     status. `danger` is signal — the ONLY status hue permitted on an action,
     because a destructive button genuinely reports the state it will produce.
══════════════════════════════════════════════════════════════════════════════ */

const button = cva(
  [
    "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
    "rounded-sm border font-ui font-medium",
    "transition-[background-color,border-color,color,box-shadow,translate] duration-fast ease-standard",
    "outline-none",
    "focus-visible:focus-ring",
    // Press: 1px down, and only when the control is live.
    "active:not-disabled:translate-y-px",
    "disabled:cursor-not-allowed disabled:opacity-50",
    // aria-busy is set while loading; pointer events stay off so a double
    // submit is impossible without the button changing size. (aria-busy is not
    // one of Tailwind's built-in aria variants, hence the explicit selector.)
    "aria-[busy=true]:cursor-progress aria-[busy=true]:pointer-events-none",
  ].join(" "),
  {
    variants: {
      variant: {
        /** The one primary action on a surface. Brand iris. */
        primary: [
          "bg-accent text-fg-on-accent border-accent",
          "hover:not-disabled:bg-accent-hover hover:not-disabled:border-accent-hover",
          "active:not-disabled:bg-accent-active",
        ].join(" "),
        /** The default. Reads as a control, not a call to action. */
        secondary: [
          "bg-surface-raised text-fg-primary border-default",
          "hover:not-disabled:bg-surface-hover hover:not-disabled:border-strong",
          "active:not-disabled:bg-surface-active",
        ].join(" "),
        /** No chrome until touched. For toolbars and table row actions. */
        ghost: [
          "bg-transparent text-fg-secondary border-transparent",
          "hover:not-disabled:bg-surface-hover hover:not-disabled:text-fg-primary",
          "active:not-disabled:bg-surface-active",
        ].join(" "),
        /** Destructive. Signal, paired with confirmation for anything irreversible. */
        danger: [
          "bg-status-failed text-fg-on-accent border-status-failed",
          "hover:not-disabled:bg-status-failed-border hover:not-disabled:border-status-failed-border",
          "active:not-disabled:bg-status-failed",
        ].join(" "),
        /** Tinted, low-emphasis affirmative. Sits under a primary without competing. */
        subtle: [
          "bg-accent-subtle text-accent border-accent-border",
          "hover:not-disabled:bg-surface-hover",
          "active:not-disabled:bg-surface-active",
        ].join(" "),
      },
      size: {
        xs: "h-6 px-2 text-caption gap-1 rounded-xs",
        sm: "h-7 px-2.5 text-body-sm",
        md: "h-8 px-3 text-body-sm",
        lg: "h-9 px-4 text-body",
      },
      iconOnly: { true: "px-0 aspect-square", false: "" },
      fullWidth: { true: "w-full", false: "" },
    },
    compoundVariants: [
      { size: "xs", iconOnly: true, className: "w-6" },
      { size: "sm", iconOnly: true, className: "w-7" },
      { size: "md", iconOnly: true, className: "w-8" },
      { size: "lg", iconOnly: true, className: "w-9" },
    ],
    defaultVariants: { variant: "secondary", size: "md", iconOnly: false, fullWidth: false },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof button>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof button>["size"]>;

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color">,
    VariantProps<typeof button> {
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  /** Swaps the label for a spinner WITHOUT changing the button's box. */
  loading?: boolean;
  /** Announced while loading. Defaults to "Loading". */
  loadingLabel?: string;
  /** Render as a child element (e.g. a Next <Link>) while keeping the styling. */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className, variant, size, iconOnly, fullWidth,
    iconLeft, iconRight, loading = false, loadingLabel = "Loading",
    asChild = false, children, disabled, type = "button", ...props
  },
  ref,
) {
  const classes = cn(button({ variant, size, iconOnly, fullWidth }), className);

  /**
   * asChild renders the caller's element (a Link, usually) with our styling.
   *
   * Radix Slot requires EXACTLY ONE child, so the loading wrapper below cannot
   * apply here — passing it would throw "React.Children.only expected to receive
   * a single React element child" at render. Callers compose their own icons
   * inside the child element; `loading` is not supported in this mode, which is
   * fine because the case it exists for (a submit that is in flight) is not a
   * link.
   */
  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  /**
   * NO LAYOUT SHIFT. The label and icons stay mounted and are hidden with
   * `invisible`, so the button keeps the exact width it had; the spinner is
   * absolutely positioned over the top. Swapping children for a spinner — the
   * usual approach — makes a row of buttons jump every time one is pressed,
   * which is unacceptable in a table where the row beneath is a click target.
   */
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      {...props}
    >
      <span className={cn("contents", loading && "invisible")}>
        {iconLeft}
        {children}
        {iconRight}
      </span>
      {loading ? (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner label={loadingLabel} />
        </span>
      ) : null}
    </button>
  );
});

/* ── IconButton ─────────────────────────────────────────────────────────────
   A Button that is only a glyph, so the accessible name cannot come from its
   text. `label` is required by the type, not merely encouraged. */
export interface IconButtonProps extends Omit<ButtonProps, "iconOnly" | "children" | "iconLeft" | "iconRight"> {
  icon: React.ReactNode;
  /** Required — this is the button's entire accessible name. */
  label: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, ...props },
  ref,
) {
  return (
    <Button ref={ref} iconOnly aria-label={label} {...props}>
      {icon}
    </Button>
  );
});

/* ── ButtonGroup ────────────────────────────────────────────────────────────
   Segmented row of related actions. Inner radii are collapsed and the shared
   border is de-duplicated with a negative margin so the seam is 1px, not 2px —
   the detail that separates a real segmented control from three buttons that
   happen to be adjacent. */
export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Announced as a group. */
  label?: string;
}

export const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(function ButtonGroup(
  { className, label, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex items-center",
        "[&>*:not(:first-child)]:-ml-px",
        "[&>*:not(:first-child):not(:last-child)]:rounded-none",
        "[&>*:first-child:not(:last-child)]:rounded-r-none",
        "[&>*:last-child:not(:first-child)]:rounded-l-none",
        // The focused member must paint above its neighbours or its ring is clipped.
        "[&>*:focus-visible]:relative [&>*:focus-visible]:z-sticky",
        "[&>*:hover]:relative",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

/* ── SplitButton ────────────────────────────────────────────────────────────
   A default action plus a menu of alternatives. The trigger is a separate
   button so the primary action stays a single click — the whole point of the
   pattern, and the thing implementations usually get wrong by making the entire
   control open the menu. */
export interface SplitButtonProps extends Omit<ButtonProps, "iconRight"> {
  /** Rendered as the menu trigger's accessible name. */
  menuLabel: string;
  /** Fired when the caret is activated. Wire this to a DropdownMenu trigger. */
  onMenuOpen?: () => void;
  /** Pass a DropdownMenu.Trigger via asChild if you need full menu semantics. */
  menuTrigger?: React.ReactNode;
}

export const SplitButton = React.forwardRef<HTMLButtonElement, SplitButtonProps>(function SplitButton(
  { menuLabel, onMenuOpen, menuTrigger, variant = "secondary", size = "md", disabled, loading, ...props },
  ref,
) {
  return (
    <ButtonGroup>
      <Button ref={ref} variant={variant} size={size} disabled={disabled} loading={loading} {...props} />
      {menuTrigger ?? (
        <IconButton
          variant={variant}
          size={size}
          disabled={disabled || loading}
          label={menuLabel}
          onClick={onMenuOpen}
          icon={<Caret />}
        />
      )}
    </ButtonGroup>
  );
});

function Caret() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3" aria-hidden="true" focusable="false">
      <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── ToggleButton ───────────────────────────────────────────────────────────
   A button with a persistent on state, exposed as aria-pressed. Pressed uses
   the brand tint rather than the primary fill: a toggle reports state, it does
   not solicit a click, so it must not out-shout a real primary action. */
export interface ToggleButtonProps extends Omit<ButtonProps, "variant"> {
  pressed: boolean;
  onPressedChange?: (pressed: boolean) => void;
}

export const ToggleButton = React.forwardRef<HTMLButtonElement, ToggleButtonProps>(
  function ToggleButton({ pressed, onPressedChange, onClick, className, ...props }, ref) {
    return (
      <Button
        ref={ref}
        aria-pressed={pressed}
        variant={pressed ? "subtle" : "ghost"}
        className={cn(pressed && "border-accent-border", className)}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) onPressedChange?.(!pressed);
        }}
        {...props}
      />
    );
  },
);

export { button as buttonVariants };
