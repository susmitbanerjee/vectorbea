"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { healthBand, type HealthBand } from "~/lib/query";
import { EMPTY } from "~/lib/format";
import type { RunStatus, TriggerKind, WorkflowStatus } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   WORKFLOW CELL VOCABULARY

   Shared by the table, the card grid and the overview so one workflow reads the
   same on all three. A status pill that is a different green on the card than in
   the row is the fastest way to make an operator wonder whether they are looking
   at the same record.
══════════════════════════════════════════════════════════════════════════════ */

/** Frozen so relative timestamps are deterministic in captures and stories. */
export const NOW = new Date("2026-08-11T14:20:00Z").getTime();

/* ── Status ───────────────────────────────────────────────────────────────── */

const STATUS_META: Record<WorkflowStatus, { label: string; className: string }> = {
  // Active borrows the success hue because a live workflow IS the healthy state.
  active: { label: "Active", className: "text-status-success border-status-success-border bg-status-success-subtle" },
  // Paused is ember: suspended by a person, resumable by a person.
  paused: { label: "Paused", className: "text-status-waiting border-status-waiting-border bg-status-waiting-subtle" },
  draft: { label: "Draft", className: "text-fg-muted border-subtle bg-surface-sunken" },
  archived: { label: "Archived", className: "text-status-cancelled border-status-cancelled-border bg-status-cancelled-subtle" },
};

export function WorkflowStatusBadge({ status, className }: { status: WorkflowStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "font-ui text-caption inline-flex min-w-0 items-center gap-1 rounded-full border px-1.5 py-0.5",
        meta.className,
        className,
      )}
    >
      <StatusDot status={status} />
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

/** Shape as well as colour, so status survives a monochrome print and colour blindness. */
function StatusDot({ status }: { status: WorkflowStatus }) {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true" className="size-1.5 shrink-0">
      {status === "active" ? <circle cx="4" cy="4" r="3" fill="currentColor" /> : null}
      {status === "paused" ? <path d="M2 1h1.6v6H2zM4.4 1H6v6H4.4z" fill="currentColor" /> : null}
      {status === "draft" ? <circle cx="4" cy="4" r="2.6" fill="none" stroke="currentColor" strokeWidth={1.2} strokeDasharray="1.6 1.4" /> : null}
      {status === "archived" ? <path d="M1 2h6v1.4H1zM2 4.2h4v2.4H2z" fill="currentColor" /> : null}
    </svg>
  );
}

/* ── Run status, for the "last run" cell ──────────────────────────────────── */

const RUN_TONE: Record<RunStatus, string> = {
  succeeded: "text-status-success",
  failed: "text-status-failed",
  running: "text-status-live",
  queued: "text-status-queued",
  "awaiting-approval": "text-status-waiting",
  cancelled: "text-status-cancelled",
};

const RUN_LABEL: Record<RunStatus, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  running: "Running",
  queued: "Queued",
  "awaiting-approval": "Awaiting approval",
  cancelled: "Cancelled",
};

export function LastRunCell({ status, at }: { status: RunStatus | null; at: string | null }) {
  if (!status) return <Text variant="caption" tone="muted">{EMPTY}</Text>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={cn("shrink-0", RUN_TONE[status])} aria-hidden="true">
        <svg viewBox="0 0 8 8" className="size-1.5">
          <circle cx="4" cy="4" r="3" fill="currentColor" />
        </svg>
      </span>
      <Text variant="caption" tone="secondary" className="truncate">
        {at ? <RelativeTime iso={at} /> : RUN_LABEL[status]}
      </Text>
      <span className="sr-only">{RUN_LABEL[status]}</span>
    </span>
  );
}

/**
 * Relative by default, absolute on hover.
 *
 * "3h ago" is what you want while scanning; the exact UTC timestamp is what you
 * need the moment you are correlating with someone else's logs.
 */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const at = Date.parse(iso);
  const absolute = `${new Date(at).toISOString().replace("T", " ").slice(0, 19)}Z`;
  const delta = NOW - at;
  const ahead = delta < 0;
  const abs = Math.abs(delta);
  const span =
    abs < 60_000 ? `${Math.round(abs / 1000)}s`
      : abs < 3_600_000 ? `${Math.round(abs / 60_000)}m`
        : abs < 86_400_000 ? `${Math.round(abs / 3_600_000)}h`
          : `${Math.round(abs / 86_400_000)}d`;

  return (
    <time dateTime={iso} title={absolute} className={className}>
      {ahead ? `in ${span}` : `${span} ago`}
    </time>
  );
}

/* ── Trigger ──────────────────────────────────────────────────────────────── */

const TRIGGER_GLYPH: Record<TriggerKind, string> = {
  schedule: "M6 3v3l2 1.4",
  webhook: "M3 6h6M7 4l2 2-2 2",
  manual: "M6 2.6v6.8M3.4 6.6 6 9.2l2.6-2.6",
  api: "M4 3.4 2 6l2 2.6M8 3.4 10 6l-2 2.6",
};

export function TriggerGlyph({ kind, className }: { kind: TriggerKind; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={cn("size-3 shrink-0", className)}>
      <path d={TRIGGER_GLYPH[kind]} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
      {kind === "schedule" ? <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth={1.1} /> : null}
    </svg>
  );
}

/** Icon plus what it actually does — "Daily 09:00 UTC", not "schedule". */
export function TriggerCell({ kind, summary }: { kind: TriggerKind; summary: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <TriggerGlyph kind={kind} className="text-fg-muted" />
      <Text variant="caption" tone="secondary" className="truncate" title={summary}>{summary}</Text>
    </span>
  );
}

/* ── Environment ──────────────────────────────────────────────────────────── */

const ENV_CLASS: Record<string, string> = {
  production: "text-env-production border-env-production/40",
  staging: "text-env-staging border-env-staging/40",
  development: "text-env-development border-env-development/40",
};

export function EnvironmentChip({ environment }: { environment: string }) {
  return (
    <span
      className={cn(
        "font-code text-[10px] uppercase tracking-wide",
        "rounded-xs border px-1 py-px",
        ENV_CLASS[environment] ?? "text-fg-muted border-subtle",
      )}
    >
      {environment === "production" ? "prod" : environment === "staging" ? "stg" : environment === "development" ? "dev" : "unknown"}
    </span>
  );
}

/* ── Health ───────────────────────────────────────────────────────────────── */

const BAND_TONE: Record<HealthBand, string> = {
  healthy: "text-status-success",
  degraded: "text-status-waiting",
  failing: "text-status-failed",
};

export const HEALTH_LABEL: Record<HealthBand, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failing: "Failing",
};

/**
 * Success rate, coloured by band.
 *
 * The percentage is the number; the band is the judgement. Showing both means a
 * scan reads the colour and a decision reads the digits, rather than an operator
 * having to hold the thresholds in their head.
 */
export function SuccessRateCell({ rate }: { rate: number }) {
  const band = healthBand(rate);
  return (
    <Text variant="caption" tone="inherit" tabular className={BAND_TONE[band]} title={`${HEALTH_LABEL[band]} — ${rate}% of the last 30 runs succeeded`}>
      {rate}%
    </Text>
  );
}

/* ── Tags ─────────────────────────────────────────────────────────────────── */

export function TagList({ tags, max = 3, onSelect }: { tags: string[]; max?: number; onSelect?: (tag: string) => void }) {
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((tag) => (
        <button
          key={tag}
          type="button"
          data-row-stop
          onClick={(e) => { e.stopPropagation(); onSelect?.(tag); }}
          disabled={!onSelect}
          className={cn(
            "font-ui text-[10px] rounded-xs border px-1 py-px",
            "border-subtle text-fg-muted",
            onSelect && "hover:border-default hover:text-fg-secondary transition-colors duration-fast",
            "outline-none focus-visible:focus-ring disabled:cursor-default",
          )}
        >
          {tag}
        </button>
      ))}
      {rest > 0 ? <Text variant="caption" tone="disabled" className="text-[10px]">+{rest}</Text> : null}
    </span>
  );
}

/* ── Steps ────────────────────────────────────────────────────────────────── */

/** `11 steps · 2 agents · 4 tools`, compressed to fit a column. */
export function StepsCell({ steps, agents, tools }: { steps: number; agents: number; tools: number }) {
  return (
    <span
      className="flex min-w-0 items-baseline gap-1"
      title={`${steps} steps, of which ${agents} agents and ${tools} tool calls`}
    >
      <Text variant="caption" tone="secondary" tabular>{steps}</Text>
      <Text variant="caption" tone="disabled" className="truncate text-[10px]">
        {agents > 0 ? `${agents}a` : null}
        {agents > 0 && tools > 0 ? " · " : null}
        {tools > 0 ? `${tools}t` : null}
      </Text>
    </span>
  );
}
