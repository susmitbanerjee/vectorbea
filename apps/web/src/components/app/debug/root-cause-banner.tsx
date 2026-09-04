"use client";

import * as React from "react";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import type { RootCause } from "~/lib/api/trace";

/**
 * The answer. The three views below are the evidence.
 *
 * Pinned across every view because the question that brought somebody here is
 * "what happened and what do I do", and making them find that in a waterfall is
 * the failure this tab exists to fix. Success criterion 1 — a non-engineer
 * identifies the failing agent and the reason in under 30 seconds without
 * opening a payload — is met here or not at all.
 *
 * Four things, in the order they get asked: what broke, whose fault it is, will
 * retrying help, and what do I press.
 */
export function RootCauseBanner({
  rootCause,
  loading,
  onRetryFromHere,
  onReconnect,
  onCompare,
  className,
}: {
  rootCause: RootCause | null;
  loading?: boolean;
  onRetryFromHere?: () => void;
  onReconnect?: () => void;
  /**
   * Open the comparison against the last run that worked.
   *
   * "It worked yesterday" is the most common report there is, and this banner is
   * where the reader already is when they think it. Making them find a tab first
   * is a step between the question and the answer.
   */
  onCompare?: () => void;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(true);

  if (loading) {
    return (
      <div
        className={cn("rounded-lg border border-subtle bg-surface-raised p-4", className)}
        aria-busy="true"
      >
        {/* Skeleton in the SHAPE of the content, so the layout does not jump when
            the answer arrives. */}
        <div className="h-3 w-32 animate-pulse rounded-xs bg-surface-sunken" />
        <div className="mt-3 h-4 w-3/4 animate-pulse rounded-xs bg-surface-sunken" />
      </div>
    );
  }

  if (!rootCause) return null;

  // Nothing failed. Saying so beats an empty region the reader has to interpret.
  if (!rootCause.rootCause) {
    return (
      <div
        className={cn(
          "rounded-lg border border-status-success-border bg-status-success-subtle px-4 py-3",
          className,
        )}
      >
        <Text variant="body" className="text-status-success">
          {rootCause.reason === "this run did not fail"
            ? "This run completed without a failure."
            : (rootCause.reason ?? "No root cause has been attributed yet.")}
        </Text>
      </div>
    );
  }

  /*
   * BUDGET is not an error and must not be painted as one.
   *
   * A run that did exactly what it was asked, more expensively than allowed, is a
   * limit doing its job. Rendering it in the same red as a broken credential is
   * how a ceiling gets reported as an outage.
   */
  const isError = rootCause.rendersAsError;
  const tone = isError
    ? { border: "border-status-failed-border", fill: "bg-status-failed-subtle", text: "text-status-failed" }
    : { border: "border-status-waiting-border", fill: "bg-status-waiting-subtle", text: "text-status-waiting" };

  const showReconnect = rootCause.failureClass === "AUTH" && onReconnect;
  /* Retrying an AUTH or POLICY failure reproduces it. Offering the button anyway
     would be inviting somebody to waste a run to learn what the verdict already
     told them. */
  const retryWorthTrying =
    rootCause.failureClass !== "AUTH" &&
    rootCause.failureClass !== "POLICY" &&
    rootCause.failureClass !== "CONFIG" &&
    onRetryFromHere;

  return (
    <section
      aria-label="Root cause"
      className={cn("rounded-lg border", tone.border, tone.fill, className)}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="root-cause-detail"
          className={cn(
            "mt-0.5 shrink-0 rounded-xs px-1 text-fg-secondary",
            "transition-opacity hover:opacity-80 active:opacity-70",
            "focus-visible:focus-ring",
            "motion-reduce:transition-none",
          )}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          <span className="sr-only">{expanded ? "Collapse" : "Expand"} root cause</span>
        </button>

        <div className="min-w-0 flex-1">
          {/* The headline: class, path, error. Scannable in one line. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                "rounded-xs px-1.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-wide",
                tone.text,
              )}
            >
              {rootCause.failureClass ?? "UNCLASSIFIED"}
            </span>
            {rootCause.concurrentLabel && (
              <span className="rounded-xs bg-surface-sunken px-1.5 py-0.5 text-xs text-fg-secondary">
                {rootCause.concurrentLabel}
              </span>
            )}
            <Text variant="body" className="font-medium text-fg-max">
              {rootCause.rootCause.name}
            </Text>
          </div>

          {expanded && (
            <div id="root-cause-detail" className="mt-2 space-y-2">
              {/* The sentence. Built server-side from the root-cause span so the
                  API and the UI cannot disagree about what happened. */}
              {rootCause.sentence && (
                <Text variant="body" className="text-fg-primary">
                  {stripMarkdownEmphasis(rootCause.sentence)}
                </Text>
              )}

              <dl className="flex flex-wrap gap-x-6 gap-y-1">
                <div className="flex gap-2">
                  <dt className="text-xs text-fg-muted">Owner</dt>
                  <dd className="text-xs font-medium text-fg-primary">
                    {rootCause.owner ?? "Unassigned"}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-xs text-fg-muted">Retrying</dt>
                  {/* The verdict in words, never a bare boolean. "No — retrying now
                      will fail the same way" is actionable; `false` is not. */}
                  <dd className="text-xs font-medium text-fg-primary">
                    {rootCause.retry ?? "Unknown"}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>

        {/* The contextual action. The verb here is the verb in the toast. */}
        <div className="flex shrink-0 gap-2">
          {showReconnect && (
            <Button size="sm" variant="primary" onClick={onReconnect}>
              Reconnect
            </Button>
          )}
          {retryWorthTrying && (
            <Button size="sm" variant="secondary" onClick={onRetryFromHere}>
              Retry from here
            </Button>
          )}
          {onCompare && (
            <Button size="sm" variant="secondary" onClick={onCompare}>
              What changed since it worked?
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The sentence arrives with `**bold**` markers from the API.
 *
 * Stripped rather than rendered: the emphasis was chosen for a plain-text
 * context, and turning it into real bold here would compete with the class chip
 * and the name already carrying weight above it.
 */
function stripMarkdownEmphasis(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1");
}
