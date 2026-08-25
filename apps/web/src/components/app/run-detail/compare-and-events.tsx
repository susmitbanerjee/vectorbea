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
   COMPARE MODE + EVENT HISTORY
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

/* ── Event history ────────────────────────────────────────────────────────── */

const EVENT_TONE = (type: string) =>
  type.includes("failed") ? "text-status-failed"
  : type.includes("committed") || type.includes("succeeded") ? "text-status-success"
  : type.includes("gate") || type.includes("suspended") ? "text-status-waiting"
  : type.includes("lease") ? "text-status-live"
  : "text-fg-secondary";

/**
 * The audit substrate, rendered to feel authoritative.
 *
 * This is not a debug panel — it is the stream the engine executes from, and
 * every other view on this page is a projection of it. Sequence numbers are
 * shown because gaplessness is the property that makes it trustworthy.
 */
/**
 * The shape this pane renders, adapted from the API's event.
 *
 * `payload` carries what the event ACTUALLY has — status, source, duration —
 * and nothing more. The generated events it replaces carried invented payloads
 * with node ids in them, which is why rows used to be clickable: there is no
 * node linkage on a real run event, so there is nothing to click through to.
 */
interface DisplayEvent {
  seq: number;
  at: number;
  type: string;
  payload: Record<string, unknown>;
}

function toDisplayEvents(events: contracts.RunEvent[]): DisplayEvent[] {
  return events
    .map((event) => ({
      seq: event.sequence,
      at: Date.parse(event.timestamp),
      type: event.type,
      payload: {
        ...(event.status ? { status: event.status } : {}),
        ...(event.source ? { source: event.source } : {}),
        ...(event.durationMs != null ? { durationMs: event.durationMs } : {}),
      },
    }))
    .sort((a, b) => a.seq - b.seq);
}

export function EventHistory({ run }: { run: Run }) {
  const { events: raw } = useReplay();
  const events = React.useMemo(() => toDisplayEvents(raw), [raw]);
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState<number | null>(null);

  const filtered = query
    ? events.filter((e) => e.type.toLowerCase().includes(query.toLowerCase()) || JSON.stringify(e.payload).toLowerCase().includes(query.toLowerCase()))
    : events;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.id}-events.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="events-heading" className="border-subtle bg-surface-raised overflow-hidden rounded-lg border">
      <div className="border-subtle flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Text variant="body-sm" tone="primary" as="h2" id="events-heading" className="font-medium">
          Event history
        </Text>
        <Text variant="caption" tone="muted" tabular>
          {events.length === 0
            ? "No events recorded"
            : `${events.length} event${events.length === 1 ? "" : "s"} · seq ${events[0].seq}–${events[events.length - 1].seq}`}
        </Text>
        <div className="ml-auto flex items-center gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter events"
            aria-label="Filter events"
            data-no-shortcuts
            className={cn(
              "bg-surface-sunken border-subtle font-code w-40 rounded-sm border px-1.5 py-0.5 text-[11px]",
              "text-fg-primary placeholder:text-fg-disabled outline-none focus-visible:focus-ring",
            )}
          />
          <Button size="sm" variant="secondary" onClick={exportJson}>Export</Button>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {events.length === 0 ? (
          <Text variant="caption" tone="muted" className="block px-3 py-4">
            This run has not emitted any events yet. A queued run emits its first the moment a
            worker picks it up.
          </Text>
        ) : null}
        <ul>
          {filtered.map((event) => (
            <EventRow
              key={event.seq}
              event={event}
              startedAt={Date.parse(run.startedAt)}
              expanded={expanded === event.seq}
              onToggle={() => setExpanded((e) => (e === event.seq ? null : event.seq))}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function EventRow({
  event, startedAt, expanded, onToggle,
}: {
  event: DisplayEvent;
  startedAt: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="border-subtle border-b last:border-b-0">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className={cn(
          "hover:bg-surface-hover flex w-full items-baseline gap-2 px-3 py-1.5 text-left",
          "transition-colors duration-instant outline-none focus-visible:focus-ring",
        )}
      >
        <span className="font-code text-fg-disabled tabular w-8 shrink-0 text-[11px]">{event.seq}</span>
        <span className="font-code text-fg-muted tabular w-16 shrink-0 text-[11px]">
          +{((event.at - startedAt) / 1000).toFixed(2)}s
        </span>
        <span className={cn("font-code w-44 shrink-0 text-[11px]", EVENT_TONE(event.type))}>{event.type}</span>
        <span className="font-code text-fg-disabled min-w-0 flex-1 truncate text-[11px]">
          {JSON.stringify(event.payload)}
        </span>
      </button>

      {expanded ? (
        <pre className="bg-surface-sunken font-code overflow-x-auto px-3 py-2 text-[11px]">
          <code className="text-fg-secondary">{JSON.stringify(event.payload, null, 2)}</code>
        </pre>
      ) : null}
    </li>
  );
}
