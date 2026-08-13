"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field } from "~/components/ui/field";
import { TIME_RANGES, type TimeRangeId } from "~/mocks/control";
import { formatSpan } from "~/mocks/control";

/* ══════════════════════════════════════════════════════════════════════════════
   TIME RANGE + REFRESH

   One range governs all four bands. Per-band ranges look flexible and produce
   dashboards where the health strip and the charts silently disagree about what
   "now" means.

   URL-SYNCED, because the only reason to change a range on Control is that you
   are about to send someone the link.
══════════════════════════════════════════════════════════════════════════════ */

export interface TimeRangeControlProps {
  value: TimeRangeId;
  onChange: (value: TimeRangeId, custom?: { from: string; to: string }) => void;
  custom?: { from: string; to: string } | null;
  className?: string;
}

export function TimeRangeControl({ value, onChange, custom, className }: TimeRangeControlProps) {
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(custom?.from ?? "");
  const [to, setTo] = React.useState(custom?.to ?? "");

  return (
    <div
      role="group"
      aria-label="Time range"
      className={cn(
        "border-default bg-surface-raised inline-flex items-center rounded-md border p-0.5",
        className,
      )}
    >
      {TIME_RANGES.map((range) => (
        <button
          key={range.id}
          onClick={() => onChange(range.id)}
          aria-pressed={value === range.id}
          className={cn(
            "font-ui text-caption tabular rounded-sm px-2 py-1",
            "transition-colors duration-fast outline-none focus-visible:focus-ring",
            value === range.id
              ? "bg-surface-active text-fg-max font-medium"
              : "text-fg-muted hover:text-fg-primary",
          )}
        >
          {range.label}
        </button>
      ))}

      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            aria-pressed={value === "custom"}
            className={cn(
              "font-ui text-caption rounded-sm px-2 py-1",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
              value === "custom"
                ? "bg-surface-active text-fg-max font-medium"
                : "text-fg-muted hover:text-fg-primary",
            )}
          >
            Custom
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            sideOffset={6}
            align="end"
            className={cn(
              "motion-overlay z-popover",
              "bg-surface-overlay border-subtle shadow-2 w-[min(20rem,calc(100vw-2rem))] rounded-md border p-3",
            )}
          >
            <Text variant="label" tone="primary" className="mb-2 block">Custom range</Text>
            <div className="grid gap-2">
              <Field label="From">
                <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Popover.Close asChild>
                <Button variant="secondary" size="sm">Cancel</Button>
              </Popover.Close>
              <Button
                variant="primary" size="sm"
                disabled={!from || !to || Date.parse(to) <= Date.parse(from)}
                onClick={() => { onChange("custom", { from, to }); setOpen(false); }}
              >
                Apply
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/* ── Refresh ──────────────────────────────────────────────────────────────── */

export interface RefreshControlProps {
  /** ms since the data was fetched. */
  ageMs: number;
  refreshing: boolean;
  onRefresh: () => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (on: boolean) => void;
  className?: string;
}

/**
 * "Last updated" is not decoration on an operational page. Data of unknown age
 * during an incident is worse than no data, because you act on it.
 */
export function RefreshControl({
  ageMs, refreshing, onRefresh, autoRefresh, onAutoRefreshChange, className,
}: RefreshControlProps) {
  const stale = ageMs > 120_000;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Text variant="caption" tone={stale ? "inherit" : "muted"} className={stale ? "text-status-waiting" : undefined}>
        Updated <span className="tabular">{ageMs < 5_000 ? "just now" : `${formatSpan(ageMs)} ago`}</span>
      </Text>

      <button
        onClick={() => onAutoRefreshChange(!autoRefresh)}
        aria-pressed={autoRefresh}
        className={cn(
          "font-ui text-caption rounded-sm px-1.5 py-1",
          "transition-colors duration-fast outline-none focus-visible:focus-ring",
          autoRefresh ? "text-accent" : "text-fg-muted hover:text-fg-primary",
        )}
      >
        Auto
      </button>

      <Button
        size="sm"
        variant="secondary"
        onClick={onRefresh}
        loading={refreshing}
        iconOnly
        aria-label="Refresh now"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" fill="none">
          <path
            d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3"
            stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      </Button>
    </div>
  );
}
