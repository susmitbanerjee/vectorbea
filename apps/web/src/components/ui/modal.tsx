"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { Text } from "./text";
import { IconButton } from "./button";

/* ══════════════════════════════════════════════════════════════════════════════
   <Modal> — the one modal surface in the product.

   Everything that creates a record opens through here, so a tool, an agent and
   a workflow cannot drift into three dialogs that happen to sit on three
   different greys.

   COMPOSED, NOT CONFIGURED. Header, step bar, rail, body and footer are
   separate exports rather than props on one component, because a five-step
   registration wizard and a two-field prompt want genuinely different chrome
   and a single component with fourteen optional props ends up expressing
   neither well.

   FOUR DECISIONS WORTH THE WORDS

   1. THE CHROME IS A BAND, NOT A SHADOW. Header, rail and footer sit on
      --bg-raised over a --bg-base body. On dark that is a one-step lift and
      reads as a physical seam; on light both resolve to paper-0 and the seam is
      carried by the 1px border, which is exactly how the light theme is
      specified to express elevation (colour.css §2b). Neither theme is the
      other one inverted, and neither needed a `dark:` variant.

   2. THE BODY SCROLLS, THE CHROME DOES NOT. A form long enough to scroll must
      never scroll its own submit button off screen. `min-h-0` on every flex
      child in the column is what makes that clamp instead of growing the dialog
      past the viewport — without it the body refuses to shrink below its
      content and max-height is silently ignored.

   3. THE PROGRESS INDICATOR EXISTS TWICE, ON PURPOSE. `ModalRail` is the
      vertical one, and it has room for a summary line per step; `ModalStepBar`
      is the horizontal fallback below `lg`, where a rail would eat half the
      width. Both are driven by the same `ModalStep[]`, so they cannot disagree.

   4. MOTION IS TRANSFORM AND OPACITY, FROM THE TOKENS (§7, rule 9). The
      `motion-overlay` and `motion-fade` utilities in motion.css already collapse
      to a 90ms fade under `prefers-reduced-motion`, so rule 10 is not something
      a call site can forget.
══════════════════════════════════════════════════════════════════════════════ */

const SIZE = {
  /** Confirmations and one-field prompts. */
  sm: "sm:max-w-[28rem]",
  /** A short form. */
  md: "sm:max-w-[36rem]",
  /** A multi-step form with no rail. */
  lg: "sm:max-w-[46rem]",
  /** A multi-step form WITH a rail. The default for record creation. */
  xl: "sm:max-w-[64rem]",
} as const;

export type ModalSize = keyof typeof SIZE;

export interface ModalStep {
  id: string;
  label: string;
  /** What this step decides. One short clause. */
  summary: string;
  /**
   * What has been decided so far, echoed back on the rail.
   *
   * This is the difference between a progress indicator and a running record of
   * the form: on step four, "Look up customer / Stripe production / GET
   * endpoint" is the answer to "what have I already said?" without navigating
   * back and losing the current step.
   */
  value?: string;
}

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: ModalSize;
  /** False blocks Escape and the overlay click — for a submit already in flight. */
  dismissible?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Modal({
  open, onOpenChange, size = "lg", dismissible = true, children, className,
}: ModalProps) {
  const guard = (event: Event) => { if (!dismissible) event.preventDefault(); };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          onEscapeKeyDown={guard}
          onPointerDownOutside={guard}
          onInteractOutside={guard}
          className={cn(
            "motion-overlay z-modal fixed flex flex-col",
            "bg-surface-base border-subtle shadow-3 border",
            // Phone: docked to the bottom edge, capped so the page behind stays visible.
            "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-xl",
            // Tablet and up: centred, capped at 88% of the viewport.
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[88dvh] sm:w-[calc(100vw-3rem)]",
            "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
            SIZE[size],
            className,
          )}
        >
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Header ───────────────────────────────────────────────────────────────── */

export interface ModalHeaderProps {
  title: React.ReactNode;
  /** Context above the title — "Build · Tools". */
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  /** A mark for the record type, in a tinted tile beside the title. */
  mark?: React.ReactNode;
  /** Disables the close button while a submit is in flight. */
  closeDisabled?: boolean;
}

export function ModalHeader({ title, eyebrow, description, mark, closeDisabled }: ModalHeaderProps) {
  return (
    <header className="border-subtle bg-surface-raised shrink-0 rounded-t-xl border-b px-4 py-3">
      <div className="flex items-start gap-3">
        {mark ? (
          <span
            className="border-accent-border bg-accent-subtle text-accent grid size-8 shrink-0 place-items-center rounded-md border"
            aria-hidden="true"
          >
            {mark}
          </span>
        ) : null}

        <div className="min-w-0 flex-1">
          {eyebrow ? <Text variant="eyebrow" tone="muted" className="mb-0.5 block">{eyebrow}</Text> : null}
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2" className="block">{title}</Text>
          </Dialog.Title>
          {description ? (
            <Dialog.Description asChild>
              <Text variant="body-sm" tone="secondary" className="mt-1 block max-w-[68ch] leading-snug">
                {description}
              </Text>
            </Dialog.Description>
          ) : null}
        </div>

        <Dialog.Close asChild>
          <IconButton
            variant="ghost"
            size="sm"
            label="Close"
            disabled={closeDisabled}
            icon={
              <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
              </svg>
            }
          />
        </Dialog.Close>
      </div>
    </header>
  );
}

/* ── Layout ───────────────────────────────────────────────────────────────── */

/**
 * The row below the header: an optional rail, then body and footer stacked.
 *
 * `min-h-0` appears on both the row and the column for the same reason it does
 * on the body — a flex child's default `min-height: auto` refuses to shrink
 * below its content, and one missing instance anywhere in the chain is enough
 * for the whole dialog to overflow the viewport instead of scrolling inside it.
 */
export function ModalLayout({ rail, children }: { rail?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      {rail ? <div className="hidden shrink-0 lg:block">{rail}</div> : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/** Scrollable content column. Takes a ref so a step change can reset the scroll. */
export const ModalBody = React.forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  function ModalBody({ children, className }, ref) {
    return (
      <div
        ref={ref}
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4", className)}
      >
        {children}
      </div>
    );
  },
);

export function ModalFooter({ hint, children }: { hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <footer className="border-subtle bg-surface-raised flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-b-xl border-t px-4 py-3">
      <div className="min-w-0 flex-1">{hint}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </footer>
  );
}

export function ModalDivider() {
  return <hr className="border-subtle border-t" />;
}

/* ── Progress ─────────────────────────────────────────────────────────────────
   Two renderings of one model.

   `reachableIndex` is the furthest step whose prerequisites are satisfied.
   Steps past it are inert rather than hidden: an operator on step two should be
   able to see that a Review step exists — knowing how much is left is most of
   what a progress indicator is for — while being unable to jump into a step
   that would open onto fields it has no answers for. */

interface ProgressProps {
  steps: ModalStep[];
  activeIndex: number;
  reachableIndex: number;
  onSelect: (index: number) => void;
}

export function ModalRail({
  steps, activeIndex, reachableIndex, onSelect, eyebrow, footnote,
}: ProgressProps & { eyebrow?: string; footnote?: string }) {
  return (
    <nav
      aria-label="Progress"
      className="border-subtle bg-surface-raised flex h-full w-60 flex-col border-r px-3 py-4"
    >
      {eyebrow ? <Text variant="eyebrow" tone="muted" className="mb-2.5 block px-1">{eyebrow}</Text> : null}

      <ol className="grid gap-0.5">
        {steps.map((step, index) => {
          const state = index < activeIndex ? "complete" : index === activeIndex ? "current" : "upcoming";
          const reachable = index <= reachableIndex && index !== activeIndex;

          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!reachable}
                aria-current={state === "current" ? "step" : undefined}
                onClick={reachable ? () => onSelect(index) : undefined}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-sm border px-2 py-1.5 text-left",
                  "transition-colors duration-fast ease-standard",
                  "outline-none focus-visible:focus-ring",
                  state === "current" ? "border-accent-border bg-accent-subtle" : "border-transparent",
                  reachable && "hover:bg-surface-hover cursor-pointer",
                  !reachable && "cursor-default",
                )}
              >
                <StepNumeral index={index} state={state} />
                <span className="min-w-0 flex-1">
                  <Text
                    variant="body-sm"
                    tone={state === "upcoming" ? "disabled" : state === "current" ? "max" : "primary"}
                    className="block truncate font-medium"
                  >
                    {step.label}
                  </Text>
                  <Text
                    variant="caption"
                    tone={state === "upcoming" ? "disabled" : "muted"}
                    className="mt-0.5 block leading-snug"
                  >
                    {/* Once a step is answered, the answer replaces the prompt —
                        the summary has done its job by then. */}
                    {step.value && state === "complete" ? step.value : step.summary}
                  </Text>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {footnote ? (
        <Text variant="caption" tone="muted" className="border-subtle mt-auto block border-t px-1 pt-3 leading-snug">
          {footnote}
        </Text>
      ) : null}
    </nav>
  );
}

/** The rail's horizontal peer, for viewports too narrow to spend 15rem on it. */
export function ModalStepBar({ steps, activeIndex, reachableIndex, onSelect }: ProgressProps) {
  return (
    <nav
      aria-label="Progress"
      className="border-subtle bg-surface-raised shrink-0 overflow-x-auto border-b px-3 py-2 lg:hidden"
    >
      <ol className="flex items-center gap-1">
        {steps.map((step, index) => {
          const state = index < activeIndex ? "complete" : index === activeIndex ? "current" : "upcoming";
          const reachable = index <= reachableIndex && index !== activeIndex;

          return (
            <li key={step.id} className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={!reachable}
                aria-current={state === "current" ? "step" : undefined}
                onClick={reachable ? () => onSelect(index) : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-1",
                  "transition-colors duration-fast ease-standard",
                  "outline-none focus-visible:focus-ring",
                  state === "current" ? "border-accent-border bg-accent-subtle" : "border-transparent",
                  reachable && "hover:bg-surface-hover cursor-pointer",
                  !reachable && "cursor-default",
                )}
              >
                <StepNumeral index={index} state={state} />
                <Text
                  variant="caption"
                  tone={state === "upcoming" ? "disabled" : state === "current" ? "max" : "secondary"}
                  className="whitespace-nowrap font-medium"
                >
                  {step.label}
                </Text>
              </button>

              {index < steps.length - 1 ? (
                <span className="bg-edge-subtle h-px w-3 shrink-0" aria-hidden="true" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepNumeral({ index, state }: { index: number; state: "complete" | "current" | "upcoming" }) {
  return (
    <span
      className={cn(
        "font-code text-mono-sm mt-px grid size-5 shrink-0 place-items-center rounded-full border tabular",
        state === "current" && "border-accent bg-accent text-fg-on-accent",
        state === "complete" && "border-accent-border text-accent",
        state === "upcoming" && "border-subtle text-fg-disabled",
      )}
      aria-hidden="true"
    >
      {state === "complete" ? (
        <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden="true">
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.5"
            fill="none" stroke="currentColor" strokeWidth={1.6}
            strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      ) : index + 1}
    </span>
  );
}

/* ── Body chrome ──────────────────────────────────────────────────────────── */

export function ModalSection({
  title, description, aside, children, className,
}: {
  title: string;
  description?: React.ReactNode;
  /** Trailing control on the title row — a "New connection" link, a Validate button. */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Text variant="label" tone="primary" as="h3" className="block">{title}</Text>
          {description ? (
            <Text variant="caption" tone="muted" className="mt-0.5 block max-w-[68ch] leading-snug">
              {description}
            </Text>
          ) : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

/**
 * An inline message about the form or one of its fields.
 *
 * `title` says what happened, the body says what to do about it — CLAUDE.md's
 * copy rule, enforced by the shape of the component rather than by review.
 */
export function ModalNote({
  tone = "neutral", title, children,
}: {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  const ring =
    tone === "danger" ? "border-status-failed-border bg-status-failed-subtle"
      : tone === "warning" ? "border-status-waiting-border bg-status-waiting-subtle"
        : tone === "success" ? "border-status-success-border bg-status-success-subtle"
          : tone === "info" ? "border-accent-border bg-accent-subtle"
            : "border-subtle bg-surface-sunken";

  const ink =
    tone === "danger" ? "text-status-failed"
      : tone === "warning" ? "text-status-waiting"
        : tone === "success" ? "text-status-success"
          : tone === "info" ? "text-accent"
            : "text-fg-primary";

  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border p-2.5", ring)}>
      <Text variant="body-sm" tone="inherit" as="p" className={cn("block font-medium", ink)}>{title}</Text>
      {children ? (
        <Text variant="body-sm" tone="secondary" className="mt-0.5 block leading-snug">{children}</Text>
      ) : null}
    </div>
  );
}
