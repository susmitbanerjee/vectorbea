"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { RootCauseIcon } from "~/components/icons/domain";
import { formatSpan } from "~/mocks/control";
import type { FailureCluster } from "~/mocks/runs-scale";

/* ══════════════════════════════════════════════════════════════════════════════
   FAILURE CLUSTERING

   "83 failed runs" is a number that makes an operator close the tab. "83 failed
   runs · 3 root causes" is a morning's work. Same data, and the second is the
   single highest-value thing on this page.

   Each cluster states the cause, the count, when it started and stopped, and —
   where the whole cluster dies at the same node position — WHERE in the graph.
   That last one is only visible because the Ribbon made node position a thing
   the product tracks: sixty-one runs all dying at step 2 is one broken
   dependency, not sixty-one broken runs.
══════════════════════════════════════════════════════════════════════════════ */

export interface FailureClustersProps {
  clusters: FailureCluster[];
  totalFailed: number;
  /** The query currently applied, so the active cluster can be marked. */
  activeQuery: string;
  onSelect: (query: string) => void;
  className?: string;
}

export function FailureClusters({
  clusters, totalFailed, activeQuery, onSelect, className,
}: FailureClustersProps) {
  const [open, setOpen] = React.useState(true);

  if (clusters.length === 0 || totalFailed === 0) return null;

  return (
    <section
      aria-labelledby="clusters-heading"
      className={cn("border-subtle bg-surface-raised overflow-hidden rounded-lg border", className)}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-left",
          "hover:bg-surface-hover transition-colors duration-fast",
          "outline-none focus-visible:focus-ring",
        )}
      >
        <RootCauseIcon size={17} aria-hidden="true" className="text-status-failed shrink-0" />
        <Text variant="body-sm" tone="primary" as="h2" id="clusters-heading" className="font-medium">
          <span className="tabular">{totalFailed.toLocaleString("en-GB")}</span> failed runs ·{" "}
          <span className="tabular">{clusters.length}</span> root{" "}
          {clusters.length === 1 ? "cause" : "causes"}
        </Text>
        <Text variant="caption" tone="muted" className="ml-auto hidden sm:block">
          {open ? "Hide" : "Show"} breakdown
        </Text>
        <ChevronGlyph open={open} />
      </button>

      {open ? (
        <ul className="border-subtle border-t">
          {clusters.map((cluster) => {
            const active = activeQuery.trim() === cluster.query.trim();
            return (
              <li
                key={cluster.id}
                className={cn(
                  "border-subtle grid gap-2 border-b px-3 py-2.5 last:border-b-0",
                  "sm:grid-cols-[auto_1fr_auto] sm:items-center",
                  active && "bg-accent-subtle",
                )}
              >
                {/* Count, with a share bar under it. The bar is what makes the
                    hierarchy pre-attentive: one dominant cause is obvious
                    without comparing three numbers. */}
                <button
                  onClick={() => onSelect(active ? "status:failed" : cluster.query)}
                  aria-pressed={active}
                  className={cn(
                    "w-full min-w-0 rounded-xs text-left sm:w-24",
                    "outline-none focus-visible:focus-ring",
                  )}
                >
                  <Text variant="body-sm" tone="inherit" tabular className="text-status-failed font-medium">
                    {cluster.count.toLocaleString("en-GB")}
                    <span className="text-fg-muted ml-1 font-normal">
                      {cluster.count === 1 ? "run" : "runs"}
                    </span>
                  </Text>
                  <span className="bg-surface-sunken mt-1 block h-1 w-full overflow-hidden rounded-full sm:w-20">
                    <span
                      className="bg-status-failed block h-full rounded-full"
                      style={{ width: `${Math.max(4, cluster.share * 100)}%` }}
                    />
                  </span>
                </button>

                <button
                  onClick={() => onSelect(active ? "status:failed" : cluster.query)}
                  className={cn(
                    "min-w-0 rounded-xs text-left outline-none focus-visible:focus-ring",
                    "hover:text-accent transition-colors duration-fast",
                  )}
                >
                  <Text variant="body-sm" tone="primary" className="block">{cluster.cause}</Text>
                  <Text variant="caption" tone="muted" className="block">
                    {cluster.failsAtStep !== null ? (
                      <>
                        every run dies at step{" "}
                        <span className="tabular">{cluster.failsAtStep + 1}</span> ·{" "}
                      </>
                    ) : null}
                    first seen {formatSpan(Date.now() - cluster.firstSeen)} ago · last{" "}
                    {formatSpan(Date.now() - cluster.lastSeen)} ago
                  </Text>
                </button>

                <Button asChild size="sm" variant="secondary" className="shrink-0 justify-self-start sm:justify-self-end">
                  <Link href={cluster.action.href as Route}>{cluster.action.label}</Link>
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={cn(
        "text-fg-muted size-3 shrink-0 transition-transform duration-fast",
        open && "rotate-180",
      )}
    >
      <path d="M3 4.5L6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
