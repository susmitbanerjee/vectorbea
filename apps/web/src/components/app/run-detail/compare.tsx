"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { formatCost, formatDuration, formatTokens, EMPTY } from "~/lib/format";
import { compareRuns } from "~/mocks/run-detail";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";
import { useScope } from "~/lib/workspace/workspace-provider";
import { toUiRun } from "~/components/app/runs/use-runs-data";
import { useReplay } from "./replay";
import type { contracts } from "@vectorbea/shared";
import type { Run } from "~/lib/runs/model";

/* ══════════════════════════════════════════════════════════════════════════════
   COMPARE MODE

   This file also held the run screen's Event history pane — a filterable table
   of raw event types, sequence numbers and payload JSON. It is gone rather than
   collapsed behind a toggle: the Debug tab answers the same question properly,
   against the span tree, with the run's structure around it, and two surfaces
   over one event stream means two things to keep true.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * Diff against the last successful run of the same workflow.
 *
 * "Which step first diverged" is the headline, not the totals. A run that is
 * 40s slower and $0.02 dearer tells you something is wrong; the step where the
 * two runs stopped agreeing tells you where.
 */
export function CompareView({ run, onClose }: { run: Run; onClose: () => void }) {
  /* THE BASELINE IS A REAL RUN.
     `lastSuccessful` searched the fixture array, so the comparison was always
     against a run that had never happened — and on a real workflow it either
     found nothing or, worse, found a fixture. The most recent succeeded run of
     the SAME workflow is a query, not a lookup. */
  const api = useApi();
  const { workspaceId } = useScope();
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const keyScope = { workspaceId, environmentId: null };

  const history = useApiQuery({
    queryKey: queryKeys.runs.list(keyScope, { page: 1, pageSize: 100, workflowId: run.workflowId }),
    queryFn: () => api.runs.list({ ...scope, page: 1, pageSize: 100 }),
    enabled: Boolean(workspaceId),
  });

  const baseline = React.useMemo(() => {
    const candidates = (history.data?.items ?? [])
      .filter((candidate) =>
        candidate.workflowId === run.workflowId
        && candidate.id !== run.id
        && (candidate.status === "succeeded" || candidate.status === "completed"))
      .sort((a, b) =>
        Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt));
    return candidates[0] ? toUiRun(candidates[0]) : undefined;
  }, [history.data, run.workflowId, run.id]);

  if (history.isPending) {
    return (
      <div className="border-subtle bg-surface-raised rounded-lg border p-4">
        <Text variant="body-sm" tone="secondary" className="block">Looking for the last successful run…</Text>
      </div>
    );
  }

  if (!baseline) {
    return (
      <div className="border-subtle bg-surface-raised rounded-lg border p-4">
        <Text variant="body-sm" tone="primary" className="block">No successful run to compare against</Text>
        <Text variant="caption" tone="muted" className="mt-1 block">
          This workflow has not succeeded yet, so there is no baseline. Compare becomes available
          after the first green run.
        </Text>
        <Button size="sm" variant="secondary" className="mt-3" onClick={onClose}>Close</Button>
      </div>
    );
  }

  const diff = compareRuns(run, baseline);

  return (
    <section aria-labelledby="compare-heading" className="border-subtle bg-surface-raised overflow-hidden rounded-lg border">
      <div className="border-subtle flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Text variant="body-sm" tone="primary" as="h2" id="compare-heading" className="font-medium">
          Compared with the last successful run
        </Text>
        <MonoId value={baseline.id} head={8} tail={4} srLabel="Baseline run identifier" />
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>Close</Button>
      </div>

      <dl className="border-subtle grid grid-cols-2 gap-x-6 gap-y-2 border-b px-3 py-2.5 sm:grid-cols-4">
        <Delta label="Duration" value={diff.durationDeltaMs} format={(v) => formatDuration(Math.abs(v))} />
        <Delta label="Tokens" value={diff.tokenDelta} format={(v) => formatTokens(Math.abs(v))} />
        <Delta label="Cost" value={diff.costDelta} format={(v) => formatCost(Math.abs(v))} />
        <div>
          <dt><Text variant="eyebrow" tone="muted">First diverged</Text></dt>
          <dd>
            <Text variant="body-sm" tone="inherit" className="text-status-failed" tabular>
              {diff.divergedAt !== null ? `Step ${diff.divergedAt + 1}` : "Never"}
            </Text>
          </dd>
        </div>
      </dl>

      <div className="max-h-72 overflow-y-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left">
          <thead>
            <tr className="border-subtle bg-surface-sunken sticky top-0 border-b">
              {["Step", "This run", "Baseline", "Δ duration", "Δ tokens", "Δ cost"].map((h) => (
                <th key={h} className="font-ui text-eyebrow text-fg-muted px-2 py-1.5 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {diff.steps.map((step) => (
              <tr
                key={step.index}
                className={cn(
                  "border-subtle border-b last:border-b-0",
                  step.index === diff.divergedAt && "bg-status-failed-subtle",
                )}
              >
                <td className="px-2 py-1.5">
                  <Text variant="caption" tone="primary" className="truncate">
                    <span className="text-fg-disabled tabular">{step.index + 1}.</span> {step.name}
                  </Text>
                </td>
                <td className="px-2 py-1.5"><StateChip state={step.currentState} /></td>
                <td className="px-2 py-1.5"><StateChip state={step.baselineState} /></td>
                <td className="px-2 py-1.5"><DeltaCell value={step.durationDeltaMs} format={(v) => `${v > 0 ? "+" : "−"}${formatDuration(Math.abs(v))}`} /></td>
                <td className="px-2 py-1.5"><DeltaCell value={step.tokenDelta} format={(v) => `${v > 0 ? "+" : "−"}${formatTokens(Math.abs(v))}`} /></td>
                <td className="px-2 py-1.5"><DeltaCell value={step.costDelta} format={(v) => `${v > 0 ? "+" : "−"}${formatCost(Math.abs(v))}`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Delta({ label, value, format }: { label: string; value: number | null; format: (v: number) => string }) {
  return (
    <div>
      <dt><Text variant="eyebrow" tone="muted">{label}</Text></dt>
      <dd>
        {value === null ? (
          <Text variant="body-sm" tone="muted">{EMPTY}</Text>
        ) : (
          <Text
            variant="body-sm"
            tone="inherit"
            tabular
            className={value > 0 ? "text-status-failed" : value < 0 ? "text-status-success" : "text-fg-primary"}
          >
            {value > 0 ? "+" : value < 0 ? "−" : ""}{format(value)}
          </Text>
        )}
      </dd>
    </div>
  );
}

function DeltaCell({ value, format }: { value: number | null; format: (v: number) => string }) {
  if (value === null) return <Text variant="caption" tone="muted">{EMPTY}</Text>;
  if (value === 0) return <Text variant="caption" tone="muted" tabular>—</Text>;
  return (
    <Text
      variant="caption"
      tone="inherit"
      tabular
      className={value > 0 ? "text-status-failed" : "text-status-success"}
    >
      {format(value)}
    </Text>
  );
}

function StateChip({ state }: { state: string | null }) {
  if (!state) return <Text variant="caption" tone="muted">absent</Text>;
  const tone =
    state === "committed" || state === "recovered" ? "text-status-success"
    : state === "failed" ? "text-status-failed"
    : state === "gated" ? "text-status-waiting"
    : state === "executing" ? "text-status-live"
    : "text-fg-disabled";
  return <Text variant="caption" tone="inherit" className={tone}>{state}</Text>;
}
