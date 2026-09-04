"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { formatCost, formatDuration } from "~/lib/format";
import { simulateVersion, type SimulationResult } from "~/mocks/workflow-versions";
import { NODE_MARKS } from "~/components/icons/nodes";
import type { Issue } from "./validation";
import type { VersionNode } from "~/mocks/workflow-nodes";

/* ══════════════════════════════════════════════════════════════════════════════
   SIMULATE PANEL — a dry run before publish.

   The same `simulateVersion` the publish flow runs, so the estimate quoted here
   and the estimate quoted on the Publish step are the same number produced by
   the same code. Two simulators would disagree, and the one people would notice
   disagreeing is the one attached to a spend decision.

   IT ALSO REPORTS WHAT WOULD FAIL AT RUNTIME. Validation catches what is wrong
   with the graph; this catches what is wrong with the world — a connection that
   is down right now, a credential that is missing. A dry run that reports a
   clean path into a database that is refusing connections is worse than no dry
   run, because it is evidence for a decision that is about to be wrong.
══════════════════════════════════════════════════════════════════════════════ */

export function SimulatePanel({
  nodes, issues, onClose,
}: {
  nodes: VersionNode[];
  issues: Issue[];
  onClose: () => void;
}) {
  const [result, setResult] = React.useState<SimulationResult | null>(null);
  const [running, setRunning] = React.useState(true);

  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setResult(simulateVersion(nodes));
      setRunning(false);
    }, 700);
    return () => window.clearTimeout(id);
  }, [nodes]);

  // Runtime failures are the RESOURCE issues: they are facts about the world
  // rather than defects in the graph, and they are the ones a dry run would
  // actually hit.
  const runtimeRisks = issues.filter((i) => i.category === "resource");
  const blocking = issues.filter((i) => i.severity === "error");

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label="Simulation"
      className={cn(
        "border-subtle bg-surface-overlay shadow-3 absolute inset-y-0 right-0 z-overlay",
        "motion-overlay flex w-[min(26rem,100vw)] flex-col border-l",
      )}
    >
      <header className="border-subtle flex items-center justify-between gap-2 border-b px-3 py-2">
        <Text variant="eyebrow" tone="muted">Simulate — dry run</Text>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the simulation"
          className={cn(
            "text-fg-muted hover:text-fg-primary grid size-6 place-items-center rounded-xs",
            "transition-colors duration-fast outline-none focus-visible:focus-ring",
          )}
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {running || !result ? (
          <div className="flex items-center gap-2">
            <Spinner className="size-4" />
            <Text variant="body-sm" tone="muted">
              Walking {nodes.length} nodes with every tool call mocked…
            </Text>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Fact label="Estimated cost" value={formatCost(result.estimatedCostUsd)} />
              <Fact label="Estimated duration" value={formatDuration(result.estimatedDurationMs)} />
              <Fact label="Mocked calls" value={String(result.mockedCalls)} />
              <Fact
                label="Gates that fire"
                value={String(result.gates.length)}
                tone={result.gates.length > 0 ? "waiting" : undefined}
              />
            </dl>

            {result.gates.length > 0 ? (
              <Text variant="caption" tone="inherit" className="text-status-waiting mt-2 block">
                {result.gates.map((g) => `${g.name} (${g.gate!.approverGroup}, ${g.gate!.slaMinutes}m SLA)`).join(", ")}.
                The duration excludes the time a person takes to answer.
              </Text>
            ) : null}

            {blocking.length > 0 ? (
              <div className="border-status-failed-border bg-status-failed-subtle mt-3 rounded-md border p-2.5">
                <Text variant="caption" tone="inherit" className="text-status-failed block">
                  {blocking.length} {blocking.length === 1 ? "error" : "errors"} would stop a real run
                </Text>
                <ul className="mt-1 grid gap-0.5">
                  {blocking.slice(0, 4).map((issue) => (
                    <li key={issue.id}>
                      <Text variant="caption" tone="secondary">{issue.title}</Text>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {runtimeRisks.length > 0 ? (
              <div className="border-status-waiting-border bg-status-waiting-subtle mt-3 rounded-md border p-2.5">
                <Text variant="caption" tone="inherit" className="text-status-waiting block">
                  Would fail against the world as it is right now
                </Text>
                <ul className="mt-1 grid gap-1">
                  {runtimeRisks.map((issue) => (
                    <li key={issue.id}>
                      <Text variant="caption" tone="secondary" className="block">{issue.title}</Text>
                      <Text variant="caption" tone="muted" className="block leading-snug">{issue.detail}</Text>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Text variant="eyebrow" tone="muted" className="mb-1 mt-4 block">Execution path</Text>
            <ol className="grid gap-px">
              {result.steps.map((step, i) => {
                const entry = NODE_MARKS.find((m) => m.type === step.kind);
                const Icon = entry?.Icon;
                return (
                  <li
                    key={step.nodeId}
                    className={cn(
                      "flex items-center gap-2 rounded-sm px-1.5 py-1",
                      step.skipped && "opacity-45",
                    )}
                  >
                    <Text variant="caption" tone="disabled" tabular className="w-4 shrink-0 text-right">
                      {i + 1}
                    </Text>
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-xs border",
                        step.gate
                          ? "border-status-waiting-border bg-status-waiting-subtle text-status-waiting"
                          : "border-subtle bg-surface-hover text-fg-secondary",
                      )}
                    >
                      {Icon ? <Icon size={11} aria-hidden="true" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-ui text-body-sm text-fg-primary block truncate">{step.name}</span>
                      {step.branch ? (
                        <span className="font-ui text-caption text-fg-muted block truncate">{step.branch}</span>
                      ) : null}
                    </span>
                    <Text variant="caption" tone="secondary" tabular className="shrink-0">
                      {formatDuration(step.durationMs)}
                    </Text>
                    <Text variant="caption" tone="secondary" tabular className="w-14 shrink-0 text-right">
                      {formatCost(step.costUsd)}
                    </Text>
                  </li>
                );
              })}
            </ol>

            <Text variant="caption" tone="muted" className="mt-3 block">
              Estimates, not measurements. Tool latency is modelled from this workspace&apos;s history;
              the number worth trusting is the shape of the path, not the fourth decimal place.
            </Text>
          </>
        )}
      </div>

      <div className="border-subtle flex justify-end gap-2 border-t p-3">
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
      </div>
    </aside>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: "waiting" }) {
  return (
    <div>
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd>
        <Text
          variant="body-sm"
          tone={tone ? "inherit" : "primary"}
          tabular
          className={tone === "waiting" ? "text-status-waiting" : undefined}
        >
          {value}
        </Text>
      </dd>
    </div>
  );
}
