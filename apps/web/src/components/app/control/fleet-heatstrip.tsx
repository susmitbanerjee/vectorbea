"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Heatstrip, HEATSTRIP_STATUS_LABEL } from "~/components/charts/heatstrip";
import { formatCost, formatPercent } from "~/lib/format";
import { formatSpan, plural, type FleetRow, type FleetSort } from "~/mocks/control";

/* ══════════════════════════════════════════════════════════════════════════════
   BAND 3 · FLEET HEATSTRIP

   One row per workflow, each row its last 30 runs. This is the element that
   competes with Datadog: twenty workflows is six hundred data points, and a
   human finds the bad one in about a second without reading a number. A sorted
   table of failure percentages cannot do that — it makes you read twenty numbers
   and hold them in your head.

   The label column is sticky. Horizontal scroll with the workflow name gone is
   thirty coloured squares belonging to nobody.
══════════════════════════════════════════════════════════════════════════════ */

const SORTS: { id: FleetSort; label: string }[] = [
  { id: "failure", label: "Failure rate" },
  { id: "recency", label: "Recency" },
  { id: "spend", label: "Spend" },
];

export interface FleetHeatstripProps {
  rows: FleetRow[];
  sort: FleetSort;
  onSortChange: (sort: FleetSort) => void;
  className?: string;
}

export function FleetHeatstrip({ rows, sort, onSortChange, className }: FleetHeatstripProps) {
  const router = useRouter();
  const [peek, setPeek] = React.useState<{ row: string; index: number } | null>(null);

  return (
    <section aria-labelledby="fleet-heading" className={cn("min-w-0", className)}>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <Text variant="heading-sm" tone="max" as="h2" id="fleet-heading">
          Fleet
        </Text>
        <Text variant="caption" tone="muted">
          {plural(rows.length, "workflow")} · last 30 runs each, oldest left
        </Text>

        <div role="group" aria-label="Sort fleet by" className="ml-auto flex items-center gap-0.5">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => onSortChange(s.id)}
              aria-pressed={sort === s.id}
              className={cn(
                "font-ui text-caption rounded-xs px-2 py-1",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
                sort === s.id
                  ? "bg-surface-active text-fg-primary"
                  : "text-fg-muted hover:text-fg-primary",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-subtle bg-surface-raised overflow-hidden rounded-lg border">
        {/* The scroller. The label column is position:sticky inside it, which is
            why the grid lives on each row rather than on a table. */}
        <div className="overflow-x-auto">
          <div className="min-w-[34rem]">
            {rows.map((row, i) => {
              const peeked = peek?.row === row.workflow.id ? peek.index : null;
              return (
                <div
                  key={row.workflow.id}
                  className={cn(
                    "grid grid-cols-[11rem_1fr_auto] items-center gap-3 px-3 py-2",
                    "hover:bg-surface-hover transition-colors duration-fast",
                    i > 0 && "border-subtle border-t",
                  )}
                >
                  {/* Label — sticky so it survives the horizontal scroll.
                      z-10 rather than the z-sticky token: this only needs to
                      beat its sibling strip, and borrowing the global chrome
                      layer would let these rows paint over the topbar when the
                      page scrolls vertically. The right edge gets a hairline so
                      the boundary the cells slide under is visible. */}
                  <div
                    className={cn(
                      "bg-surface-raised sticky left-0 z-10 min-w-0 pr-3",
                      "after:border-subtle after:absolute after:inset-y-0 after:right-0 after:w-px after:border-r after:content-['']",
                    )}
                  >
                    <Link
                      href={`/workflows/${row.workflow.id}` as Route}
                      className={cn(
                        "font-ui text-body-sm text-fg-primary hover:text-accent block truncate rounded-xs",
                        "transition-colors duration-fast outline-none focus-visible:focus-ring",
                      )}
                    >
                      {row.workflow.name}
                    </Link>
                    <Text variant="caption" tone="muted" className="block truncate">
                      {peeked !== null ? (
                        <>
                          {HEATSTRIP_STATUS_LABEL[row.last30[peeked]]} ·{" "}
                          {row.last30.length - peeked} run{row.last30.length - peeked === 1 ? "" : "s"} ago
                        </>
                      ) : row.lastRunAt !== null ? (
                        <>
                          {row.workflow.environment} · {formatSpan(NOW_OFFSET(row.lastRunAt))} ago
                        </>
                      ) : (
                        <>{row.workflow.environment} · no runs in range</>
                      )}
                    </Text>
                  </div>

                  <Heatstrip
                    label={row.workflow.name}
                    statuses={row.last30}
                    runIds={row.runIds}
                    onHover={(index) =>
                      setPeek(index === null ? null : { row: row.workflow.id, index })
                    }
                    onSelect={(_, runId) => {
                      if (runId) router.push(`/runs/${runId}` as Route);
                    }}
                  />

                  {/* The metric the current sort is about, so the ordering is
                      legible rather than mysterious. */}
                  <div className="w-20 shrink-0 text-right">
                    <Text
                      variant="body-sm"
                      tone={row.failureRate > 0.5 ? "inherit" : "secondary"}
                      tabular
                      className={row.failureRate > 0.5 ? "text-status-failed" : undefined}
                    >
                      {formatPercent(row.failureRate * 100)}
                    </Text>
                    <Text variant="caption" tone="muted" tabular className="block">
                      {formatCost(row.spendUsd)}
                    </Text>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function NOW_OFFSET(at: number): number {
  return Date.now() - at;
}
