"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { CountRoll } from "~/components/app/shell/count-roll";
import { Burndown } from "~/components/charts/burndown";
import { formatCost } from "~/lib/format";
import { formatSpan, type HealthSnapshot } from "~/mocks/control";
import {
  InFlightIcon, BudgetBurnIcon, SlaTimerIcon, TokenMeterIcon,
} from "~/components/icons/domain";
import type { IconComponent } from "~/components/icons/types";

/* ══════════════════════════════════════════════════════════════════════════════
   BAND 1 · HEALTH STRIP

   One strip, not four cards. Four equal-weight tiles say "here are four numbers,
   good luck"; a strip with internal dividers says "this is one reading of the
   system" and lets each cell size to its content instead of to a grid.

   Every cell is a link. That is the rule for this whole page: a number an
   operator cannot click is a number they have to go and look up somewhere else,
   which is what made the old Overview a dead end.
══════════════════════════════════════════════════════════════════════════════ */

export interface HealthStripProps {
  health: HealthSnapshot;
  className?: string;
}

export function HealthStrip({ health, className }: HealthStripProps) {
  const { inFlight, failureBudget, approvals, spend } = health;

  const overBudget = failureBudget.burnRatio !== null && failureBudget.burnRatio > 1;
  const projectedOver = spend.budgetUsd !== null && spend.projectedUsd > spend.budgetUsd;

  /**
   * Past about 2× the allowance, a percentage stops being readable — "983%
   * burned" is arithmetically correct and lands as noise. A multiplier keeps the
   * magnitude legible at any scale, which is the whole reason this metric
   * replaced "41% success rate".
   */
  const burnLabel = failureBudget.burnRatio === null
    ? "Not set"
    : failureBudget.burnRatio > 2
      ? `${failureBudget.burnRatio.toFixed(1)}×`
      : `${Math.round(failureBudget.burnRatio * 100)}%`;
  const burnSuffix = failureBudget.burnRatio === null
    ? "configure"
    : failureBudget.burnRatio > 2 ? "over budget" : "burned";

  return (
    <section
      aria-label="Workspace health"
      className={cn(
        "border-subtle bg-surface-raised overflow-hidden rounded-lg border",
        "grid grid-cols-1 divide-y divide-[var(--border-subtle)]",
        "md:grid-cols-2 md:divide-y-0",
        "xl:grid-cols-4",
        // Vertical dividers only where the cells actually sit side by side.
        "md:[&>*:nth-child(odd)]:border-r md:[&>*:nth-child(odd)]:border-[var(--border-subtle)]",
        "md:[&>*:nth-child(-n+2)]:border-b md:[&>*:nth-child(-n+2)]:border-[var(--border-subtle)]",
        "xl:[&>*]:border-r xl:[&>*]:border-[var(--border-subtle)] xl:[&>*:last-child]:border-r-0",
        "xl:[&>*:nth-child(-n+2)]:border-b-0",
        className,
      )}
    >
      {/* ── In flight ──────────────────────────────────────────────────── */}
      <HealthCell
        href={"/runs?status=running" as Route}
        icon={InFlightIcon}
        label="In flight now"
        tone={inFlight.running > 0 ? "live" : "neutral"}
      >
        <div className="flex items-baseline gap-2">
          <span className="relative flex items-center">
            {inFlight.running > 0 ? (
              <span
                aria-hidden="true"
                data-motion="decorative"
                className="bg-status-live absolute -left-3.5 size-1.5 rounded-full motion-safe:animate-[ink-bloom_2s_ease-in-out_infinite]"
              />
            ) : null}
            <Text variant="display-md" tone="max" tabular>
              <CountRoll value={inFlight.running} />
            </Text>
          </span>
          <Text variant="body-sm" tone="muted">running</Text>
        </div>
        <CellFoot>
          {inFlight.queued} queued · oldest waiting {formatSpan(inFlight.oldestQueuedMs)}
        </CellFoot>
      </HealthCell>

      {/* ── Failure budget ─────────────────────────────────────────────── */}
      <HealthCell
        href={(failureBudget.target === null
          ? "/settings/usage#operational-budgets"
          : "/runs?status=failed") as Route}
        icon={BudgetBurnIcon}
        label="Failure budget"
        tone={overBudget ? "failed" : "neutral"}
      >
        <div className="flex items-baseline gap-1.5">
          <Text
            variant="display-md"
            tone={overBudget ? "inherit" : "max"}
            tabular
            className={overBudget ? "text-status-failed" : undefined}
          >
            {burnLabel}
          </Text>
          {/* nowrap: "over budget" breaking after "over" left the cell a line
              taller than its three neighbours. */}
          <Text variant="body-sm" tone="muted" className="whitespace-nowrap">
            {burnSuffix}
          </Text>
        </div>

        {/* Stacked under the metric, matching the spend cell. Side by side, the
            chart and the label fought for the same 40px once the strip narrowed
            to two columns. */}
        {failureBudget.target !== null ? (
          <Burndown series={failureBudget.series} height={26} className="mt-2" />
        ) : null}

        <CellFoot>
          {failureBudget.target === null || failureBudget.allowed === null ? (
            "Set a reliability target in Settings"
          ) : (
            <><span className="tabular">{failureBudget.spent}</span> of{" "}
            <span className="tabular">{failureBudget.allowed.toFixed(2)}</span> allowed ·{" "}
            {(failureBudget.target * 100).toFixed(2)}% target</>
          )}
        </CellFoot>
      </HealthCell>

      {/* ── Approvals aging ────────────────────────────────────────────── */}
      <HealthCell
        href={"/approvals" as Route}
        icon={SlaTimerIcon}
        label="Approvals aging"
        tone={approvals.available && approvals.breached > 0 ? "failed" : approvals.available && approvals.pressured ? "waiting" : "neutral"}
      >
        {approvals.available ? (
          <>
            <div className="flex items-baseline gap-2">
              <Text variant="display-md" tone="max" tabular>
                <CountRoll value={approvals.count} />
              </Text>
              <Text variant="body-sm" tone="muted">waiting</Text>
            </div>
            <CellFoot>
              oldest <span className={cn("tabular", approvals.pressured ? "text-status-waiting" : undefined)}>
                {formatSpan(approvals.oldestWaitedMs)}
              </span>{" "}
              of a {formatSpan(approvals.oldestSlaMs)} SLA
              {approvals.breached > 0 ? (
                <> · <span className="text-status-failed">{approvals.breached} breached</span></>
              ) : null}
            </CellFoot>
          </>
        ) : (
          <>
            <Text variant="display-md" tone="max">Unavailable</Text>
            <CellFoot>Approval telemetry did not answer; no count is inferred.</CellFoot>
          </>
        )}
      </HealthCell>

      {/* ── Spend ──────────────────────────────────────────────────────── */}
      <HealthCell
        href={"/settings/usage" as Route}
        icon={TokenMeterIcon}
        label="Spend today"
        tone={projectedOver ? "waiting" : "neutral"}
      >
        <div className="flex items-baseline gap-2">
          <Text variant="display-md" tone="max" tabular>
            {formatCost(spend.spentUsd)}
          </Text>
          <Text variant="body-sm" tone="muted">
            {spend.budgetUsd === null ? "no budget set" : `of ${formatCost(spend.budgetUsd)}`}
          </Text>
        </div>

        {spend.budgetUsd !== null ? (
          <SpendBar spent={spend.spentUsd} projected={spend.projectedUsd} budget={spend.budgetUsd} />
        ) : null}

        <CellFoot>
          {spend.budgetUsd === null ? "Set a daily budget · projecting " : "projecting "}
          <span className={cn("tabular", projectedOver ? "text-status-waiting" : undefined)}>
            {formatCost(spend.projectedUsd)}
          </span>{" "}
          by 00:00
        </CellFoot>
      </HealthCell>
    </section>
  );
}

/* ── Cell ─────────────────────────────────────────────────────────────────── */

type CellTone = "neutral" | "live" | "waiting" | "failed";

const TONE_ICON: Record<CellTone, string> = {
  neutral: "text-fg-muted",
  live: "text-status-live",
  waiting: "text-status-waiting",
  failed: "text-status-failed",
};

function HealthCell({
  href, icon: Glyph, label, tone, children,
}: {
  href: Route;
  icon: IconComponent;
  label: string;
  tone: CellTone;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group block min-w-0 p-4",
        "hover:bg-surface-hover transition-colors duration-fast",
        "outline-none focus-visible:focus-ring",
      )}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <Glyph size={14} aria-hidden="true" className={TONE_ICON[tone]} />
        <Text variant="eyebrow" tone="muted">{label}</Text>
        <ArrowCue />
      </div>
      {children}
    </Link>
  );
}

/** Appears on hover so the cell reads as navigable without shouting when idle. */
function ArrowCue() {
  return (
    <svg
      viewBox="0 0 12 12" aria-hidden="true"
      className={cn(
        "text-fg-disabled ml-auto size-3 shrink-0",
        "opacity-0 transition-opacity duration-fast",
        "group-hover:opacity-100 group-focus-visible:opacity-100",
      )}
    >
      <path d="M3 9L9 3M9 3H4.5M9 3v4.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CellFoot({ children }: { children: React.ReactNode }) {
  return <Text variant="caption" tone="muted" className="mt-1.5 block">{children}</Text>;
}

/**
 * Spend against budget, with a projection tick beyond the filled portion.
 * The projection is the useful part: £4.10 of £12 looks fine until you see it
 * is on course for £14.60.
 */
function SpendBar({ spent, projected, budget }: { spent: number; projected: number; budget: number }) {
  const scaleMax = Math.max(budget, projected) * 1.04;
  const spentPct = Math.min(100, (spent / scaleMax) * 100);
  const projectedPct = Math.min(100, (projected / scaleMax) * 100);
  const budgetPct = Math.min(100, (budget / scaleMax) * 100);
  const over = projected > budget;

  return (
    <div className="bg-surface-sunken relative mt-2 h-1.5 w-full overflow-hidden rounded-full">
      {/* Projected — the ghost ahead of actual spend. */}
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-status-waiting/25" : "bg-accent/20")}
        style={{ width: `${projectedPct}%` }}
      />
      <div
        className="bg-accent absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${spentPct}%` }}
      />
      {/* Budget ceiling. */}
      <div
        aria-hidden="true"
        className="bg-fg-muted absolute inset-y-0 w-px"
        style={{ left: `${budgetPct}%` }}
      />
    </div>
  );
}
