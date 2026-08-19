"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import { ribbonSummary } from "~/components/app/ribbon/geometry";
import { formatCost, formatDuration, formatTokens } from "~/lib/format";
import type { Run } from "~/lib/runs/model";

/* ══════════════════════════════════════════════════════════════════════════════
   QUICK PEEK

   Hovering a row shows the Ribbon at sm, the failure message if there is one,
   and the two actions worth taking without leaving the list.

   WHY IT EARNS ITS KEEP. The xs Ribbon in the row answers "where did it die".
   The peek answers "what killed it" — enough to decide between retry and
   investigate without a round trip to run detail and back, which is the loop an
   operator does eighty times during an incident.

   Delayed 320ms and dismissed instantly. A popover that appears the moment the
   cursor crosses a row makes the whole table flicker while you are just moving
   toward the scrollbar.
══════════════════════════════════════════════════════════════════════════════ */

export interface QuickPeekProps {
  run: Run | null;
  anchor: HTMLElement | null;
  onRetry: (run: Run) => void;
}

const OPEN_DELAY_MS = 320;

export function QuickPeek({ run, anchor, onRetry }: QuickPeekProps) {
  const router = useRouter();
  const [shown, setShown] = React.useState<{ run: Run; rect: DOMRect } | null>(null);

  React.useEffect(() => {
    if (!run || !anchor) { setShown(null); return; }
    const timer = window.setTimeout(() => {
      setShown({ run, rect: anchor.getBoundingClientRect() });
    }, OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [run, anchor]);

  if (!shown) return null;

  const { run: r, rect } = shown;
  const failedNode = r.nodes.find((n) => n.state === "failed");

  // Flip above the row when there is no room below, and clamp to the viewport
  // so a peek on the last row is never half off-screen.
  const PEEK_HEIGHT = 200;
  const below = rect.bottom + PEEK_HEIGHT < window.innerHeight;
  const top = below ? rect.bottom + 6 : rect.top - PEEK_HEIGHT - 6;
  const left = Math.min(Math.max(12, rect.left + 48), window.innerWidth - 380);

  return (
    <div
      role="tooltip"
      aria-label={`Quick view of run ${r.id}`}
      style={{ top, left, width: 360 }}
      className={cn(
        "motion-overlay pointer-events-auto fixed z-popover",
        "bg-surface-overlay border-subtle shadow-3 rounded-md border p-3",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Text variant="body-sm" tone="primary" className="min-w-0 truncate font-medium">
          {r.workflowName}
        </Text>
        <MonoId value={r.id} head={7} tail={4} srLabel="Run identifier" />
      </div>

      <div className="mt-2.5">
        {r.nodes.length > 0 ? (
          <>
            <CheckpointRibbon nodes={r.nodes} size="sm" runId={`peek-${r.id}`} />
            <Text variant="caption" tone="muted" className="mt-1.5 block">
              {ribbonSummary(r.nodes)}
            </Text>
          </>
        ) : (
          <Text variant="caption" tone="muted">Checkpoint data is not available for this run.</Text>
        )}
      </div>

      {failedNode ? (
        <div className="border-status-failed-border bg-status-failed-subtle mt-2.5 rounded-sm border p-2">
          <Text variant="caption" tone="inherit" className="text-status-failed block font-medium">
            {failedNode.name}
          </Text>
          <Text variant="caption" tone="secondary" className="mt-0.5 block">
            {failedNode.error?.message ?? "Failed without a structured error."}
          </Text>
          {failedNode.error?.connection ? (
            <Text variant="caption" tone="muted" className="mt-0.5 block">
              Connection ‘{failedNode.error.connection}’
            </Text>
          ) : null}
        </div>
      ) : null}

      <dl className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Fact label="Duration" value={formatDuration(r.durationMs)} />
        <Fact label="Tokens" value={formatTokens(r.tokens)} />
        <Fact label="Cost" value={formatCost(r.costUsd)} />
      </dl>

      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={r.status !== "failed" && r.status !== "cancelled"}
          onClick={() => onRetry(r)}
        >
          Retry
        </Button>
        <Button size="sm" variant="secondary" onClick={() => router.push(`/runs/${r.id}` as Route)}>
          Open
        </Button>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd><Text variant="caption" tone="primary" tabular>{value}</Text></dd>
    </div>
  );
}
