"use client";

import * as React from "react";
import { Icon } from "~/components/ui/icon";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { Warning, WarningCircle, GraphIcon } from "@phosphor-icons/react/dist/ssr";
import type { TraceCompleteness } from "~/lib/api/trace";

/**
 * The six states every collection in this tab has to have a design for.
 *
 * ── WHY THESE ARE COMPONENTS AND NOT `if` BRANCHES ──────────────────────────
 * Loading, empty, live, partial, unavailable and success-with-warnings are six
 * different answers, and the ones that get skipped are always the same three:
 * a run still executing renders as a run that did less than it did; an
 * unreadable trace renders as an empty one, which asserts that nothing happened;
 * and a successful run with warnings renders as an unblemished success.
 *
 * Written once, they are hard to forget. Left to each view, five of six were.
 */

// ── Loading ─────────────────────────────────────────────────────────────────

/**
 * A skeleton in the SHAPE OF THE CONTENT, not a spinner.
 *
 * The Flow view's content is a run bar over a left-to-right row of nodes of
 * varying width, so that is what this is. A centred spinner tells the reader
 * nothing about what is coming and makes the arrival a layout jump.
 */
export function FlowSkeleton() {
  /* Deterministic widths rather than random: a skeleton that reflows on every
     render draws the eye to itself, and this must be the calmest thing here. */
  const widths = [120, 176, 96, 208, 144];
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading the run">
      <div className="space-y-1.5">
        <div className="h-2.5 w-full animate-pulse rounded-full bg-surface-sunken motion-reduce:animate-none" />
        <div className="flex gap-4">
          {[64, 80, 72].map((w) => (
            <div key={w} style={{ width: `${w}px` }}
                 className="h-3 animate-pulse rounded-xs bg-surface-sunken motion-reduce:animate-none" />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {widths.map((w, i) => (
          <React.Fragment key={w}>
            {i > 0 && <div className="h-px w-6 shrink-0 bg-border-subtle" />}
            <div
              style={{ width: `${w}px` }}
              className="h-16 shrink-0 animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none"
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Empty ───────────────────────────────────────────────────────────────────

/**
 * Nothing was recorded — said as a fact about the TRACE, never about the run.
 *
 * "No steps" would claim the run did nothing. What we actually know is that no
 * spans reached us, and the two have entirely different fixes.
 */
export function EmptyTrace({ hint }: { hint?: string }) {
  return (
    <Panel icon={GraphIcon} tone="neutral" heading="No trace was recorded for this run">
      {hint ??
        "The run either finished before tracing was switched on, or its spans have " +
        "passed their retention window. The run's own result is unaffected."}
    </Panel>
  );
}

// ── Unavailable ─────────────────────────────────────────────────────────────

/**
 * The trace could not be READ. Distinct from empty, and it must stay distinct:
 * rendering an empty graph as the answer says the run did nothing.
 */
export function TraceUnavailable({
  message, onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Panel icon={WarningCircle} tone="failed" heading="The trace could not be loaded">
      {message}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "mt-2 block rounded-xs px-1 text-sm text-fg-link",
            "transition-opacity hover:opacity-80 motion-reduce:transition-none",
            "focus-visible:focus-ring",
          )}
        >
          Try again
        </button>
      )}
    </Panel>
  );
}

// ── Structure missing ───────────────────────────────────────────────────────

/**
 * The spans are fine but the workflow version is gone.
 *
 * Runs outlive the versions that made them. The nodes still render, in
 * execution order, with no edges — and this says why, so an absent structure
 * does not read as a workflow that had none.
 */
export function GraphUnavailableNote() {
  return (
    <div className="rounded-md border border-subtle bg-surface-raised px-3 py-2">
      <div className="flex items-baseline gap-2">
        <Text variant="label" className="text-fg-secondary">Showing steps without the workflow structure</Text>
      </div>
      <Text variant="caption" className="mt-0.5 block text-fg-muted">
        The workflow version this run used could not be read, so connections
        between steps are not drawn. Steps appear in the order they executed.
      </Text>
    </div>
  );
}

// ── Success with warnings ───────────────────────────────────────────────────

/**
 * The state that is always forgotten: it worked, AND there is something to say.
 *
 * A run that succeeded after two retries with a truncated context is one
 * provider hiccup from failing and its agent reasoned from incomplete
 * information. Rendering it as an unbroken row of green is not neutral — it is
 * an assertion that there was nothing to see.
 *
 * Deliberately NOT amber as a whole: the run succeeded, and colouring the
 * headline like a warning would overstate it. The markers carry the amber.
 */
export function SuccessWithWarnings({
  warningCount, nodeCount, kinds,
}: {
  warningCount: number;
  nodeCount: number;
  kinds: string[];
}) {
  if (warningCount === 0) return null;
  return (
    <div className="rounded-md border border-subtle bg-surface-raised px-3 py-2">
      <div className="flex items-center gap-2">
        <Icon icon={Warning} size="sm" decorative className="text-status-waiting" />
        <Text variant="label" className="text-fg-max">
          This run succeeded, with {warningCount} thing{warningCount === 1 ? "" : "s"} worth knowing
        </Text>
      </div>
      <Text variant="caption" className="mt-0.5 block text-fg-secondary">
        {kinds.join(" · ")} — across {nodeCount} step{nodeCount === 1 ? "" : "s"}.
        Marked on the steps below.
      </Text>
    </div>
  );
}

// ── Completeness ────────────────────────────────────────────────────────────

/**
 * Whether this is the whole story — four states, one of which renders nothing.
 *
 * Replaced a single amber box driven by `traceComplete`, which meant "the run
 * span is closed", was rendered as "spans were dropped under buffer pressure",
 * and fired on healthy completed runs. A warning that fires on healthy runs is
 * worse than no warning: it teaches people that amber means nothing.
 */
export function CompletenessBanner({
  completeness, children,
}: {
  completeness: TraceCompleteness | null | undefined;
  /** Extra muted detail, e.g. depth truncation, folded into the same block. */
  children?: React.ReactNode;
}) {
  const c = completeness;
  if (!c || c.state === "complete") {
    return children ? <>{children}</> : null;
  }

  const { tone, heading } = completenessPresentation(c);

  return (
    <div className={cn("rounded-md border px-3 py-2", tone.border, tone.fill)}>
      <div className="flex items-baseline gap-2">
        <Text variant="label" className={tone.text}>{heading}</Text>
        {c.state === "live" && (
          <span aria-hidden="true"
                className="size-1.5 shrink-0 animate-pulse rounded-full bg-status-live motion-reduce:animate-none" />
        )}
      </div>
      {c.reason && (
        <Text variant="caption" className="mt-0.5 block text-fg-secondary">{c.reason}</Text>
      )}
      {c.state === "partial" && (
        <Text variant="caption" className="mt-0.5 block text-fg-muted">
          The timeline and waterfall are missing that work. The run map and root
          cause are built from what was recorded and remain accurate for it.
        </Text>
      )}
      {children}
    </div>
  );
}

/**
 * Which tone and heading each state gets.
 *
 * Pulled out of the component because it is the part that was WRONG, and a
 * screenshot of a healthy run does not show it. Two rules are encoded here:
 *
 *   - `live` is NEUTRAL. A run still going is a status, not a warning, and
 *     colouring it amber is how the old banner taught people to ignore amber.
 *   - amber is reserved for `partial`, the only state that is actually a claim
 *     about missing data, and it carries the count.
 */
export function completenessPresentation(c: TraceCompleteness): {
  tone: { border: string; fill: string; text: string };
  heading: string;
} {
  switch (c.state) {
    case "live":
      return {
        tone: { border: "border-subtle", fill: "bg-surface-raised", text: "text-fg-secondary" },
        heading: "This run is still going",
      };
    case "unavailable":
      return {
        tone: { border: "border-status-failed-border", fill: "bg-status-failed-subtle", text: "text-status-failed" },
        heading: "The trace could not be loaded",
      };
    default:
      return {
        tone: { border: "border-status-waiting-border", fill: "bg-status-waiting-subtle", text: "text-status-waiting" },
        heading: c.droppedSpans > 0
          ? `${c.droppedSpans} span${c.droppedSpans === 1 ? "" : "s"} missing`
          : "Incomplete trace",
      };
  }
}

// ── Shared shell ────────────────────────────────────────────────────────────

function Panel({
  icon, tone, heading, children,
}: {
  icon: React.ComponentProps<typeof Icon>["icon"];
  tone: "neutral" | "failed";
  heading: string;
  children: React.ReactNode;
}) {
  const failed = tone === "failed";
  return (
    <div
      className={cn(
        "flex min-h-48 flex-col items-center justify-center rounded-md border px-6 py-8 text-center",
        failed
          ? "border-status-failed-border bg-status-failed-subtle"
          : "border-subtle bg-surface-raised",
      )}
    >
      <Icon
        icon={icon}
        size="lg"
        decorative
        className={cn("mb-2", failed ? "text-status-failed" : "text-fg-muted")}
      />
      <Text variant="label" className={failed ? "text-status-failed" : "text-fg-max"}>
        {heading}
      </Text>
      <Text variant="caption" className="mt-1 block max-w-[52ch] text-fg-secondary">
        {children}
      </Text>
    </div>
  );
}
