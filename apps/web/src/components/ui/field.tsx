"use client";

import * as React from "react";
import { cn } from "~/lib/cn";

/* ══════════════════════════════════════════════════════════════════════════════
   <Field> — the wrapper every form control sits inside.

   Design §12 and CLAUDE.md: errors state what happened and how to fix it, and
   they render ADJACENT TO THE FIELD, never only in a summary at the top of the
   form. A top-of-form error list makes the operator hunt; on a 40-field workflow
   config that is a genuine time sink.

   It also owns the wiring that is tedious and therefore skipped: generating ids,
   pointing aria-describedby at BOTH the description and the error, and setting
   aria-invalid. Controls consume that through the useFieldControl() hook, so a
   call site cannot forget it.
══════════════════════════════════════════════════════════════════════════════ */

type FieldContextValue = {
  id: string;
  descriptionId?: string;
  errorId?: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
};

const FieldContext = React.createContext<FieldContextValue | null>(null);

/**
 * Props a control should spread onto its input element. Returns empty when the
 * control is used outside a <Field>, so primitives stay usable standalone.
 */
export function useFieldControl(): {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
  disabled?: boolean;
} {
  const ctx = React.useContext(FieldContext);
  if (!ctx) return {};
  const describedBy = [ctx.descriptionId, ctx.errorId].filter(Boolean).join(" ") || undefined;
  return {
    id: ctx.id,
    "aria-describedby": describedBy,
    "aria-invalid": ctx.invalid || undefined,
    "aria-required": ctx.required || undefined,
    disabled: ctx.disabled || undefined,
  };
}

export interface FieldProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  label: React.ReactNode;
  /** Supporting text. Rendered above the control so it is read before input. */
  description?: React.ReactNode;
  /** Present = invalid. The message must say what to do, not just what failed. */
  error?: React.ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Show "n / max". Pair with a controlled value. */
  characterCount?: { value: number; max: number };
  /** Visually hide the label while keeping it available to screen readers. */
  labelHidden?: boolean;
}

export const Field = React.forwardRef<HTMLDivElement, FieldProps>(function Field(
  {
    label, description, error, required = false, disabled = false,
    characterCount, labelHidden = false, className, children, ...props
  },
  ref,
) {
  const reactId = React.useId();
  const id = `field-${reactId}`;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const invalid = Boolean(error);

  const ctx = React.useMemo<FieldContextValue>(
    () => ({ id, descriptionId, errorId, invalid, required, disabled }),
    [id, descriptionId, errorId, invalid, required, disabled],
  );

  const over = characterCount ? characterCount.value > characterCount.max : false;

  return (
    <FieldContext.Provider value={ctx}>
      <div ref={ref} className={cn("flex flex-col gap-1.5", className)} {...props}>
        <div className="flex items-baseline justify-between gap-3">
          <label
            htmlFor={id}
            className={cn(
              "font-ui text-label text-fg-secondary",
              labelHidden && "sr-only",
              disabled && "text-fg-disabled",
            )}
          >
            {label}
            {required ? (
              // A glyph AND a label — colour alone never carries meaning (§14).
              <span className="text-status-failed ml-0.5" aria-hidden="true">*</span>
            ) : null}
            {required ? <span className="sr-only"> (required)</span> : null}
          </label>

          {characterCount ? (
            <span
              className={cn(
                "font-code text-mono-sm tabular shrink-0",
                // The count borrows the LABEL's line-height rather than mono's.
                // The row is as tall as its tallest inline box, and mono-sm's
                // line box is ~1px taller than the label's — so a field with a
                // character count sat 1px above the field beside it, for the
                // whole life of the form. Not enough to name, exactly enough to
                // look untidy. Baseline alignment still positions it.
                "leading-(--text-label--line-height)",
                over ? "text-status-failed" : "text-fg-muted",
              )}
              aria-live="polite"
            >
              {characterCount.value} / {characterCount.max}
            </span>
          ) : null}
        </div>

        {description ? (
          <p id={descriptionId} className={cn("font-ui text-caption text-fg-muted", disabled && "text-fg-disabled")}>
            {description}
          </p>
        ) : null}

        {children}

        {/* Reserved space is NOT used here on purpose: a permanently reserved
            error row on a 40-field form wastes a third of the viewport. The
            error is announced politely instead, and the control's own border
            colour is what shifts, so the layout move is one text line. */}
        {error ? (
          <p
            id={errorId}
            role="alert"
            className="font-ui text-caption text-status-failed flex items-start gap-1.5"
          >
            <ErrorGlyph />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
});

function ErrorGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="mt-px size-3.5 shrink-0" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 2.5 14 13H2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.7" fill="currentColor" />
    </svg>
  );
}

/**
 * Shared control chrome. Every text-like input uses this so the border,
 * background, focus ring and invalid treatment are defined exactly once.
 *
 * Not the shadcn silhouette: the resting state is a SUNKEN surface with a
 * 1px border, so an input reads as a slot cut into the panel rather than a card
 * floating on it. That is what makes a dense form scan as a form.
 */
export const controlBase = [
  "w-full font-ui text-body-sm text-fg-primary",
  "bg-surface-sunken border border-default rounded-sm",
  "placeholder:text-fg-muted",
  "transition-[border-color,box-shadow,background-color] duration-fast ease-standard",
  "outline-none",
  "hover:not-disabled:border-strong",
  "focus-visible:focus-ring focus-visible:border-focus",
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-hover",
  "aria-[invalid=true]:border-status-failed",
].join(" ");

export const controlSize = {
  sm: "h-7 px-2",
  md: "h-8 px-2.5",
  lg: "h-9 px-3",
} as const;

export type ControlSize = keyof typeof controlSize;
