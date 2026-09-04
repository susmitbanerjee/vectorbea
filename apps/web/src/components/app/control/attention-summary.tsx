"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { openInbox, type InboxSeverity } from "~/components/app/shell/inbox-signal";
import { IncidentIcon, CheckpointIcon } from "~/components/icons/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   NEEDS ATTENTION — one line, on the way to the bell

   The full triage feed lives in the notification inbox now. This is the line
   that stayed behind, and it is here on purpose.

   Moving the feed into a dropdown is right — it makes triage reachable from
   every screen instead of only this one. Moving it there ENTIRELY is not: an
   operator opens Control precisely to find out whether anything is wrong, and a
   closed popover answers that question only if you already thought to open it.
   A count and a severity colour in the page's own reading order preserves the
   at-a-glance read the band used to give, at about a fortieth of the height.

   It is a button, not a card. The resolving actions live in the inbox; this
   only has to say how bad it is and get you there in one click.
══════════════════════════════════════════════════════════════════════════════ */

export interface AttentionSummaryProps {
  /** How many items need attention. Zero renders the all-clear line. */
  count: number;
  /** Worst severity present, used for the accent. */
  worst: InboxSeverity | null;
  className?: string;
}

const TONE: Record<InboxSeverity, { dot: string; text: string; word: string }> = {
  critical: { dot: "bg-status-failed", text: "text-status-failed", word: "critical" },
  high: { dot: "bg-status-waiting", text: "text-status-waiting", word: "high" },
  medium: { dot: "bg-fg-muted", text: "text-fg-secondary", word: "medium" },
  info: { dot: "bg-fg-muted", text: "text-fg-secondary", word: "informational" },
};

export function AttentionSummary({ count, worst, className }: AttentionSummaryProps) {
  if (count === 0) {
    return (
      <div
        className={cn(
          "border-status-success-border bg-status-success-subtle flex items-center gap-2 rounded-md border px-3 py-2",
          className,
        )}
      >
        <CheckpointIcon size={16} aria-hidden="true" className="text-status-success shrink-0" />
        <Text variant="body-sm" tone="primary">Nothing needs attention.</Text>
      </div>
    );
  }

  const tone = TONE[worst ?? "medium"];

  return (
    <button
      type="button"
      onClick={openInbox}
      className={cn(
        "border-subtle bg-surface-raised group flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left",
        "hover:border-default transition-colors duration-fast outline-none focus-visible:focus-ring",
        className,
      )}
    >
      <IncidentIcon size={16} aria-hidden="true" className={cn("shrink-0", tone.text)} />

      <Text variant="body-sm" tone="primary" className="font-medium">
        <span className="tabular">{count}</span> item{count === 1 ? "" : "s"} need
        {count === 1 ? "s" : ""} attention
      </Text>

      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", tone.dot)} />
      <Text variant="caption" tone="muted">highest severity {tone.word}</Text>

      <Text variant="caption" tone="muted" className="ml-auto hidden sm:block">
        Open inbox
      </Text>
    </button>
  );
}
