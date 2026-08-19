import * as React from "react";
import { cn } from "~/lib/cn";

/**
 * <NotAvailableYet> — the honest empty state for a gapped feature.
 *
 * This is degradation policy (c) made concrete. The three things it must never
 * be replaced by:
 *
 *   a spinner   — a perpetual skeleton is a lie with extra steps; it says
 *                 "loading" about something that is never going to load
 *   a zero      — "0 runs blocked" and "we cannot compute what is blocked" are
 *                 different facts, and only one of them is true
 *   mock data   — indistinguishable from real data is the worst outcome of all
 *
 * So it states plainly that the data does not exist yet. `reason` is optional
 * and is for the operator-facing case where knowing *why* changes what they do
 * next ("the endpoint ships with the next API release" is actionable; "coming
 * soon" is not).
 */
export interface NotAvailableYetProps {
  /** What is missing, as a noun phrase: "Queue position", "Blast radius". */
  label: string;
  /** One sentence on why, when that helps the reader decide what to do. */
  reason?: string;
  /** Compact form for inline use inside a table cell or a stat tile. */
  inline?: boolean;
  className?: string;
}

export function NotAvailableYet({ label, reason, inline, className }: NotAvailableYetProps) {
  if (inline) {
    return (
      <span
        className={cn("text-fg-muted text-xs", className)}
        title={reason ? `${label} is not available yet. ${reason}` : undefined}
      >
        Not available yet
      </span>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-start gap-1 rounded-md border border-subtle bg-sunken px-4 py-3",
        className,
      )}
    >
      <p className="text-fg-secondary text-sm">{label} is not available yet.</p>
      {reason ? <p className="text-fg-muted text-xs">{reason}</p> : null}
    </div>
  );
}
