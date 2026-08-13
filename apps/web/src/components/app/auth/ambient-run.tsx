"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import { Text } from "~/components/ui/text";
import type { CellState, RunNode } from "~/mocks/domain";

/**
 * <AmbientRun> — the left panel of the auth screens.
 *
 * A durable run committing at a calm pace: roughly one node every 2.5 seconds,
 * looping. It replaces the static bullet list that every competitor's sign-in
 * also has, and it makes the product's one claim while someone types a password.
 *
 * AMBIENT MEANS AMBIENT. No bloom, no ring, no breathing on the executing cell —
 * the Ribbon's full motion vocabulary belongs in the product where a commit is
 * news. Here it would compete with the form, which is the only thing on this
 * page the visitor came to use. Cells simply crossfade.
 *
 * Frozen entirely under prefers-reduced-motion, showing a completed run.
 */

const NODES = [
  "Schedule trigger", "Load accounts", "contracts.getUpcomingRenewals",
  "Classify risk", "Branch on tier", "postgres.query", "Draft outreach",
  "Await approval", "slack.postMessage", "Commit checkpoint",
];

const STEP_MS = 2500;

export function AmbientRun({ className }: { className?: string }) {
  const [committed, setCommitted] = React.useState(3);
  const [frozen, setFrozen] = React.useState(false);

  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      setFrozen(query.matches);
      if (query.matches) setCommitted(NODES.length);
    };
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  React.useEffect(() => {
    if (frozen) return;
    const timer = setInterval(() => {
      setCommitted((c) => (c >= NODES.length ? 1 : c + 1));
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [frozen]);

  const nodes = React.useMemo<RunNode[]>(
    () =>
      NODES.map((name, i) => ({
        id: `n${i}`,
        name,
        kind: "tool",
        state: (i < committed ? "committed" : i === committed ? "executing" : "pending") as CellState,
        durationMs: i < committed ? 900 + i * 140 : null,
        tokens: null,
        costUsd: null,
        at: i < committed ? new Date().toISOString() : null,
      })),
    [committed],
  );

  return (
    <div className={cn("flex flex-col justify-between gap-10", className)}>
      <div>
        <Text variant="eyebrow" tone="accent" className="mb-4 block">
          Durable execution for agentic workflows
        </Text>
        <Text variant="display-md" tone="max" as="p" className="max-w-[16ch] text-balance">
          Agents that resume, not restart.
        </Text>
        <Text variant="body-lg" tone="secondary" className="mt-5 block max-w-[42ch]">
          Every completed step commits a checkpoint that survives a crash. A failure at step 7 resumes
          at step 7 — it does not replay the six that already worked.
        </Text>
      </div>

      <div>
        {/* `interactive={false}` and a stable runId keep this inert: it never
            claims the global animation slot, so it cannot steal the bloom from a
            real Ribbon elsewhere on the page. */}
        <CheckpointRibbon nodes={nodes} size="md" runId="auth-ambient" />
        <div className="mt-3 flex items-baseline gap-2">
          <Text variant="mono-sm" tone="secondary" className="tabular">
            {Math.min(committed, NODES.length)} / {NODES.length}
          </Text>
          <Text variant="caption" tone="muted">
            {frozen ? "committed" : "checkpoints committed"}
          </Text>
        </div>
      </div>
    </div>
  );
}
