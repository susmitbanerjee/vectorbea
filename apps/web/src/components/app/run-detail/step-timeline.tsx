"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { formatCost, formatDuration, formatTokens } from "~/lib/format";
import { useReplay, statesAt } from "./replay";
import type { CellState } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   LEFT PANE · STEP TIMELINE

   The duration bar is proportional to the SLOWEST step, not to the run total.
   Against the total, a 12-node run gives every bar about 8% and the whole column
   reads flat — the one node taking 40% of the wall clock looks like the rest.
   Against the max, that node is full width and everything else is visibly
   shorter, which is the question this column exists to answer.

   The failed step is expanded by default with its error, because on a failed run
   that is the only step anyone opened the page for.
══════════════════════════════════════════════════════════════════════════════ */

const STATE_DOT: Record<CellState, string> = {
  committed: "bg-status-success",
  recovered: "bg-status-success",
  executing: "bg-status-live",
  gated: "bg-status-waiting",
  failed: "bg-status-failed",
  pending: "bg-transparent border border-[var(--border-default)]",
  skipped: "bg-transparent border border-dashed border-[var(--border-default)]",
};

const STATE_BAR: Record<CellState, string> = {
  committed: "bg-status-success",
  recovered: "bg-status-success",
  executing: "bg-status-live",
  gated: "bg-status-waiting",
  failed: "bg-status-failed",
  pending: "bg-surface-active",
  skipped: "bg-surface-active",
};

export function StepTimeline({ className }: { className?: string }) {
  const { run, focusIndex, selectedIndex, scrubbing, select } = useReplay();
  const states = React.useMemo(
    () => statesAt(run.nodes, focusIndex, scrubbing),
    [run.nodes, focusIndex, scrubbing],
  );

  const maxDuration = React.useMemo(
    () => Math.max(1, ...run.nodes.map((n) => n.durationMs ?? 0)),
    [run.nodes],
  );

  const listRef = React.useRef<HTMLOListElement>(null);

  /* Scrubbing scrolls this pane to the head, so the timeline follows the
     pointer rather than making the operator find the step themselves. */
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-step="${focusIndex}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: scrubbing ? "auto" : "smooth" });
  }, [focusIndex, scrubbing]);

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden", className)}>
      <PaneHeader title="Steps">
        <Text variant="caption" tone="muted" tabular>
          {run.nodes.filter((n) => n.state === "committed" || n.state === "recovered").length}/
          {run.nodes.length} committed
        </Text>
      </PaneHeader>

      <ol ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {run.nodes.map((node, index) => {
          const state = states[index];
          const active = index === focusIndex;
          const selected = index === selectedIndex;
          const expanded = state === "failed" || active;
          const share = node.durationMs ? (node.durationMs / maxDuration) * 100 : 0;

          return (
            <li key={node.id} data-step={index}>
              <button
                onClick={() => select(index)}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "border-subtle w-full border-b px-2.5 py-2 text-left",
                  "transition-colors duration-instant hover:bg-surface-hover",
                  "outline-none focus-visible:focus-ring",
                  active && "bg-surface-active",
                  selected && !active && "bg-surface-selected",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      STATE_DOT[state],
                      state === "executing" && "motion-safe:animate-[ink-bloom_1.6s_ease-in-out_infinite]",
                    )}
                    data-motion="decorative"
                  />
                  <span className="font-code text-mono-sm text-fg-disabled tabular w-5 shrink-0">
                    {index + 1}
                  </span>
                  <span className="font-ui text-body-sm text-fg-primary min-w-0 flex-1 truncate">
                    {node.name}
                  </span>
                  {node.attempt && node.attempt > 1 ? (
                    <span className="font-code text-[10px] text-status-waiting shrink-0">
                      ×{node.attempt}
                    </span>
                  ) : null}
                </div>

                {/* Proportional bar. Transform-scaled, so it never animates
                    width — rule 9. */}
                <div className="mt-1.5 flex items-center gap-2 pl-[1.75rem]">
                  <span className="bg-surface-sunken relative h-1 min-w-0 flex-1 overflow-hidden rounded-full">
                    <span
                      className={cn("absolute inset-y-0 left-0 w-full origin-left rounded-full", STATE_BAR[state])}
                      style={{ transform: `scaleX(${Math.max(share, node.durationMs ? 2 : 0) / 100})` }}
                    />
                  </span>
                  <span className="font-code text-mono-sm text-fg-muted tabular shrink-0">
                    {formatDuration(node.durationMs)}
                  </span>
                </div>

                {expanded ? (
                  <div className="mt-1.5 pl-[1.75rem]">
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      {node.tokens ? (
                        <Text variant="caption" tone="muted" tabular>{formatTokens(node.tokens)} tok</Text>
                      ) : null}
                      {node.costUsd ? (
                        <Text variant="caption" tone="muted" tabular>{formatCost(node.costUsd)}</Text>
                      ) : null}
                      <Text variant="caption" tone="muted">{node.kind}</Text>
                    </div>

                    {node.state === "failed" && node.error ? (
                      <div className="border-status-failed-border bg-status-failed-subtle mt-1.5 rounded-sm border p-1.5">
                        <Text variant="caption" tone="inherit" className="text-status-failed block">
                          {node.error.message}
                        </Text>
                        {node.error.connection ? (
                          <Text variant="caption" tone="muted" className="mt-0.5 block">
                            connection ‘{node.error.connection}’
                          </Text>
                        ) : null}
                      </div>
                    ) : null}

                    {node.state === "recovered" ? (
                      <Text variant="caption" tone="inherit" className="text-status-success mt-1 block">
                        Recovered on attempt {node.attempt}
                      </Text>
                    ) : null}
                  </div>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function PaneHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="border-subtle bg-surface-sunken flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5">
      <Text variant="eyebrow" tone="muted">{title}</Text>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
