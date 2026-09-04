"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDown, ArrowRight, ArrowUp, Gauge, Minus, Robot, TreeStructure,
  WarningCircle, WarningDiamond,
} from "@phosphor-icons/react/dist/ssr";
import { Icon } from "~/components/ui/icon";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/cn";
import { formatCostCents } from "~/lib/format";
import type {
  BudgetPressureRow, FailureAgentRow, FailureClassRow, FailureOwnerRow,
  FailureRollup, FailureWindow, FailureWorkflowRow, RecurringFailure,
  WorkspaceTraceCompleteness,
} from "~/lib/api/failures";

/**
 * The failures roll-up.
 *
 * ── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 * The taxonomy already labels every failed run. On a run page that label answers
 * "what went wrong here". It cannot answer "what is wrong with this workspace",
 * because the answer to that is a shape across hundreds of runs, and nobody sees
 * a shape by opening runs one at a time.
 *
 * ── WHY OWNER IS THE FIRST SECTION AND NOT THE THIRD ────────────────────────
 * Sorting by count produces a ranking nobody can act on: the top row might be
 * AUTH, which the workflow builder reading the page cannot fix, above CONFIG,
 * which is theirs and is three rows down. Grouping by owner turns one list into
 * the two or three separate queues it always was. That grouping is the page.
 *
 * The class table stays, underneath, because the owner view answers "is this
 * mine" and the class table answers "what kind of thing is it".
 *
 * ── WHAT IT REFUSES TO DO ───────────────────────────────────────────────────
 * BUDGET never renders red. A run that stopped at its ceiling did exactly what
 * it was configured to do; painting it as a crash teaches the reader to ignore
 * the colour that means a crash. It is a distinct, calm tone throughout, and the
 * server sends `rendersAsError: false` so the rule lives in one place.
 */

// ── Vocabulary ──────────────────────────────────────────────────────────────

const WINDOWS: Array<{ key: FailureWindow; label: string; full: string }> = [
  { key: "24h", label: "24h", full: "Last 24 hours" },
  { key: "7d", label: "7d", full: "Last 7 days" },
  { key: "30d", label: "30d", full: "Last 30 days" },
  { key: "90d", label: "90d", full: "Last 90 days" },
];

/**
 * How a class row is painted.
 *
 * Two tones, not ten. A colour per class would be a legend to memorise and would
 * collide with the status ramp the rest of the product uses; the only distinction
 * that changes what the reader does is "this broke" versus "this stopped".
 */
function classTone(row: { rendersAsError: boolean }) {
  return row.rendersAsError
    ? {
        text: "text-status-failed",
        bar: "bg-status-failed",
        border: "border-status-failed-border",
        fill: "bg-status-failed-subtle",
        icon: WarningCircle,
      }
    : {
        /* BUDGET. A limit that worked, not a fault. */
        text: "text-status-waiting",
        bar: "bg-status-waiting",
        border: "border-status-waiting-border",
        fill: "bg-status-waiting-subtle",
        icon: Gauge,
      };
}

/** `TOOL_FAILURE` → `Tool failure`. Sentence case, per the copy rules. */
function humanClass(name: string): string {
  const s = name.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function Section({
  title, hint, count, children, id,
}: {
  title: string;
  hint: string;
  count?: number;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <div className="mb-2 flex items-baseline gap-3">
        <Text variant="heading-sm" tone="max" as="h2" id={id}>{title}</Text>
        {count !== undefined ? (
          <Text variant="caption" tone="muted" tabular>{count}</Text>
        ) : null}
      </div>
      <Text variant="body-sm" tone="secondary" className="mb-3 block max-w-[76ch]">
        {hint}
      </Text>
      {children}
    </section>
  );
}

/**
 * A row's link to a real run.
 *
 * Every count on this page is one click from the Debug tab of a run that
 * produced it. A count with no example is a statistic; a count with a run behind
 * it is a place to start.
 */
function SampleRunLink({ runId, label }: { runId: string; label: string }) {
  return (
    <Link
      href={`/runs/${runId}/debug`}
      className={cn(
        /* fg-link, not accent: `accent` is the brand surface colour and `fg-link`
           is the one tuned for text on a surface. Both are iris — that is fine
           here, because a link is a destination, not a status. */
        "text-fg-link inline-flex shrink-0 items-center gap-1 text-xs",
        "rounded-xs hover:underline",
        "focus-visible:focus-ring",
      )}
    >
      {label}
      <Icon icon={ArrowRight} size="xs" decorative />
    </Link>
  );
}

function OwnerChip({ owner }: { owner: string }) {
  return (
    <span className="border-subtle text-fg-secondary rounded-full border px-2 py-0.5 text-xs">
      {owner}
    </span>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-subtle rounded-md border border-dashed px-4 py-6 text-center">
      <Text variant="body-sm" tone="muted">{children}</Text>
    </div>
  );
}

// ── Trend ───────────────────────────────────────────────────────────────────

/**
 * The change against the same length of time before this window.
 *
 * Null `changePct` renders as "new", not as "+100%". A class that went from zero
 * to four is not a four-hundred-percent increase; it is a thing that started
 * happening, and those read completely differently to someone deciding what to
 * look at first.
 *
 * The arrow is not the only encoding — the number carries its own sign, and the
 * screen-reader text says the direction in words.
 */
function Trend({ row }: { row: FailureClassRow }) {
  if (row.changePct === null) {
    return row.count > 0 ? (
      <span className="text-fg-secondary inline-flex items-center gap-1 text-xs">
        <Icon icon={ArrowUp} size="xs" decorative />
        new
        <span className="sr-only">— none in the previous window</span>
      </span>
    ) : null;
  }

  if (row.changePct === 0) {
    return (
      <span className="text-fg-muted inline-flex items-center gap-1 text-xs tabular">
        <Icon icon={Minus} size="xs" decorative />
        level
      </span>
    );
  }

  const up = row.changePct > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs tabular",
        /*
         * Rising is worse, so up takes the ROW's tone — which for BUDGET is
         * amber, not red. A page whose premise is "nothing here is a crash"
         * cannot have its only red pixel sitting on a budget row; a reader
         * scanning for red would find it there and learn to distrust the colour.
         *
         * Down is NOT the success hue either: fewer AUTH failures this week is
         * not a success, it is a smaller number, and brand green, status green
         * and "less bad" must stay three different things.
         */
        up ? classTone(row).text : "text-fg-secondary",
      )}
    >
      <Icon icon={up ? ArrowUp : ArrowDown} size="xs" decorative />
      {up ? "+" : ""}{row.changePct}%
      <span className="sr-only">
        {up ? "up" : "down"} from {row.previousCount} in the previous window
      </span>
    </span>
  );
}

// ── 7. Trace completeness ───────────────────────────────────────────────────

/**
 * How much of this workspace's tracing survived.
 *
 * At the TOP when it undermines the page, because every number below is computed
 * from evidence the runs left behind, and a reader who acts on a classification
 * built from partial traces should know that before they act, not after.
 *
 * When completeness is fine it is a quiet line at the bottom instead — the same
 * fact, sized to how much it matters.
 */
function Completeness({ c, prominent }: { c: WorkspaceTraceCompleteness; prominent: boolean }) {
  if (c.runs === 0) return null;

  if (!prominent) {
    return (
      <Text variant="caption" tone="muted" className="mt-8 block" tabular>
        Traces complete for {pct(1 - c.partialShare)} of {c.runs.toLocaleString()} runs
        {c.droppedSpans > 0
          ? ` — ${c.droppedSpans.toLocaleString()} spans dropped under load.`
          : "."}
      </Text>
    );
  }

  return (
    <div
      role="status"
      /* status-WAITING, the amber ramp. There is no `status-warning` token —
         writing one produces no colour at all, silently, which is how the agents
         view once drew succeeded nodes with no fill. Same amber the Debug tab's
         own completeness banner uses, deliberately: it is the same claim. */
      className="border-status-waiting-border bg-status-waiting-subtle mb-6 flex gap-3 rounded-md border p-4"
    >
      <Icon icon={WarningDiamond} size="sm" className="text-status-waiting mt-0.5 shrink-0" decorative />
      <div className="min-w-0">
        <Text variant="body-sm" tone="max" className="block font-medium">
          {pct(c.partialShare)} of runs in this window have incomplete traces
        </Text>
        <Text variant="body-sm" tone="secondary" className="mt-1 block max-w-[76ch]">
          {c.partialRuns.toLocaleString()} of {c.runs.toLocaleString()} runs dropped
          spans under load, losing {c.droppedSpans.toLocaleString()} in total. Every
          figure below is attributed from the spans that survived, so root causes on
          those runs may be missing or wrong. Raising the span buffer or reducing
          concurrency restores it.
        </Text>
      </div>
    </div>
  );
}

// ── 2. By owner — the queues ────────────────────────────────────────────────

function OwnerQueues({ owners, total }: { owners: FailureOwnerRow[]; total: number }) {
  if (owners.length === 0) {
    /* Each empty state says what ITS section would have held. Three sections
       repeating one sentence reads as a rendering bug rather than a quiet week. */
    return <EmptyRow>Nothing failed in this window, so nobody has a queue.</EmptyRow>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {owners.map((o) => (
        <div key={o.owner} className="border-subtle bg-surface-raised rounded-lg border p-4">
          <div className="flex items-baseline justify-between gap-2">
            <Text variant="label" tone="max" className="truncate">{o.owner}</Text>
            <Text variant="heading-sm" tone="max" tabular>{o.count.toLocaleString()}</Text>
          </div>

          {/* Share of the workspace's failures. Width is the only thing this bar
              encodes, and the number above it says the same thing in figures. */}
          <div className="bg-surface-sunken mt-2 h-1 overflow-hidden rounded-full" aria-hidden>
            <div
              className="bg-fg-secondary h-full origin-left rounded-full"
              style={{ width: total === 0 ? "0%" : `${(o.count / total) * 100}%` }}
            />
          </div>
          <Text variant="caption" tone="muted" className="mt-1 block" tabular>
            {total === 0 ? "0%" : pct(o.count / total)} of all failures
          </Text>

          <ul className="mt-3 space-y-1">
            {o.classes.map((c) => (
              <li key={c.class} className="flex items-baseline justify-between gap-2">
                <Text variant="body-sm" tone="secondary" className="truncate">
                  {humanClass(c.class)}
                </Text>
                <Text variant="body-sm" tone="primary" tabular>{c.count.toLocaleString()}</Text>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── 1. By class, with trend ─────────────────────────────────────────────────

function ClassTable({ rows }: { rows: FailureClassRow[] }) {
  if (rows.length === 0) return <EmptyRow>Nothing failed, so there is nothing to classify.</EmptyRow>;

  return (
    <div className="border-subtle overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[42rem] border-collapse text-left">
        <thead>
          <tr className="border-subtle text-fg-muted border-b text-xs">
            <th scope="col" className="px-4 py-2 font-medium">Class</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Failures</th>
            <th scope="col" className="px-4 py-2 font-medium">Share</th>
            <th scope="col" className="px-4 py-2 font-medium">Trend</th>
            <th scope="col" className="px-4 py-2 font-medium">Owner</th>
            <th scope="col" className="px-4 py-2 font-medium">Retry</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tone = classTone(r);
            return (
              <React.Fragment key={r.class}>
                <tr className="border-subtle border-b last:border-b-0">
                  <td className="px-4 py-2.5 align-top">
                    <span className="flex items-center gap-2">
                      <Icon icon={tone.icon} size="xs" className={cn(tone.text, "shrink-0")} decorative />
                      <Text variant="body-sm" tone="max" className="font-medium">
                        {humanClass(r.class)}
                      </Text>
                    </span>
                    <Text variant="caption" tone="muted" className="mt-0.5 block max-w-[52ch]">
                      {r.summary}
                    </Text>
                  </td>
                  <td className="px-4 py-2.5 text-right align-top">
                    <Text variant="body-sm" tone="max" tabular>{r.count.toLocaleString()}</Text>
                  </td>
                  <td className="w-32 px-4 py-2.5 align-top">
                    <span className="flex items-center gap-2">
                      <span className="bg-surface-sunken h-1.5 w-16 overflow-hidden rounded-full" aria-hidden>
                        <span
                          className={cn("block h-full rounded-full", tone.bar)}
                          style={{ width: `${r.shareOfTotal * 100}%` }}
                        />
                      </span>
                      <Text variant="caption" tone="secondary" tabular>{pct(r.shareOfTotal)}</Text>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top"><Trend row={r} /></td>
                  <td className="px-4 py-2.5 align-top"><OwnerChip owner={r.owner} /></td>
                  <td className="px-4 py-2.5 align-top">
                    <Text variant="caption" tone="secondary">{r.retry}</Text>
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 4. Recurring root causes ────────────────────────────────────────────────

/**
 * The same thing failing over and over, collapsed.
 *
 * One expired credential across forty runs is ONE row here — that collapse is
 * the whole reason the section exists, and `workflows` is what stops the collapse
 * from hiding blast radius: one credential breaking six workflows reads
 * completely differently from one workflow failing six times.
 */
function Recurring({ rows }: { rows: RecurringFailure[] }) {
  if (rows.length === 0) {
    return (
      <EmptyRow>
        Nothing failed more than once in this window. Every failure here is
        its own event.
      </EmptyRow>
    );
  }

  return (
    <ol className="space-y-2">
      {rows.map((r) => {
        const tone = classTone({ rendersAsError: r.class !== "BUDGET" });
        return (
          <li
            key={`${r.class}:${r.stepId}:${r.stepName}`}
            className={cn(
              "border-subtle bg-surface-raised rounded-md border p-3",
              "flex flex-wrap items-center gap-x-4 gap-y-2",
            )}
          >
            {/* The count leads. This list is ranked, and the rank is the point. */}
            <Text variant="heading-sm" tone="max" tabular className={cn("w-12 shrink-0 text-right", tone.text)}>
              {r.count.toLocaleString()}
            </Text>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Text variant="body-sm" tone="max" className="font-medium">{r.stepName}</Text>
                <Text variant="mono-sm" tone="muted" className="truncate">{r.stepId}</Text>
              </div>
              <Text variant="caption" tone="secondary" className="mt-0.5 block">
                {humanClass(r.class)} · {r.kind.replace(/_/g, " ")}
                {r.workflows > 1 ? ` · across ${r.workflows} workflows` : ""}
                {r.lastSeen ? ` · last ${new Date(r.lastSeen).toLocaleString()}` : ""}
              </Text>
            </div>

            <OwnerChip owner={r.owner} />
            <SampleRunLink runId={r.sampleRunId} label="Debug a run" />
          </li>
        );
      })}
    </ol>
  );
}

// ── 3. By workflow and by agent ─────────────────────────────────────────────

type Grouping = "workflow" | "agent";

function GroupedTable({
  grouping, workflows, agents,
}: {
  grouping: Grouping;
  workflows: FailureWorkflowRow[];
  agents: FailureAgentRow[];
}) {
  if (grouping === "workflow") {
    if (workflows.length === 0) return <EmptyRow>No workflow failed in this window.</EmptyRow>;
    return (
      <div className="border-subtle overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] border-collapse text-left">
          <thead>
            <tr className="border-subtle text-fg-muted border-b text-xs">
              <th scope="col" className="px-4 py-2 font-medium">Workflow</th>
              <th scope="col" className="px-4 py-2 font-medium">Class</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Runs</th>
              <th scope="col" className="px-4 py-2 font-medium">Owner</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                <span className="sr-only">Example run</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {workflows.map((w) => (
              <tr key={`${w.workflowId}:${w.class}`} className="border-subtle border-b last:border-b-0">
                <td className="px-4 py-2.5">
                  <Text variant="body-sm" tone="max" className="block max-w-[28ch] truncate">
                    {w.workflowName}
                  </Text>
                </td>
                <td className="px-4 py-2.5">
                  <Text variant="body-sm" tone="secondary">{humanClass(w.class)}</Text>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Text variant="body-sm" tone="max" tabular>{w.count.toLocaleString()}</Text>
                </td>
                <td className="px-4 py-2.5"><OwnerChip owner={w.owner} /></td>
                <td className="px-4 py-2.5 text-right">
                  <SampleRunLink runId={w.sampleRunId} label="Debug" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <EmptyRow>
        No agent activation failed in this window. Failures outside an agent —
        an HTTP node, a mapping — are counted by workflow, not here.
      </EmptyRow>
    );
  }

  return (
    <div className="border-subtle overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <thead>
          <tr className="border-subtle text-fg-muted border-b text-xs">
            <th scope="col" className="px-4 py-2 font-medium">Agent</th>
            <th scope="col" className="px-4 py-2 font-medium">Class</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Activations</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">Runs</th>
            <th scope="col" className="px-4 py-2 font-medium">Owner</th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              <span className="sr-only">Example run</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr key={`${a.agentId}:${a.class}`} className="border-subtle border-b last:border-b-0">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2">
                  <Icon icon={Robot} size="xs" className="text-fg-muted shrink-0" decorative />
                  <Text variant="body-sm" tone="max" className="max-w-[24ch] truncate">
                    {a.agentName}
                  </Text>
                </span>
                {a.workflows > 1 ? (
                  <Text variant="caption" tone="muted" className="mt-0.5 block">
                    in {a.workflows} workflows
                  </Text>
                ) : null}
              </td>
              <td className="px-4 py-2.5">
                <Text variant="body-sm" tone="secondary">{humanClass(a.class)}</Text>
              </td>
              <td className="px-4 py-2.5 text-right">
                <Text variant="body-sm" tone="max" tabular>{a.count.toLocaleString()}</Text>
              </td>
              {/* Activations and runs differ when an agent was retried inside one
                  run. Both are shown because which it is changes the fix. */}
              <td className="px-4 py-2.5 text-right">
                <Text variant="body-sm" tone="secondary" tabular>{a.runs.toLocaleString()}</Text>
              </td>
              <td className="px-4 py-2.5"><OwnerChip owner={a.owner} /></td>
              <td className="px-4 py-2.5 text-right">
                <SampleRunLink runId={a.sampleRunId} label="Debug" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 6. Budget pressure ──────────────────────────────────────────────────────

/**
 * Workflows that regularly finish just under a ceiling.
 *
 * These runs SUCCEEDED — which is exactly why they are worth a section on a
 * failures page. A workflow habitually finishing at 92% of its budget is one
 * longer input away from a BUDGET row, and now is the only moment fixing it is
 * cheap. Rendered in the budget tone throughout, never in the failure tone,
 * because nothing here has failed yet.
 */
function BudgetPressure({ rows }: { rows: BudgetPressureRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyRow>
        No workflow is finishing near its ceiling. Workflows with no cost ceiling
        set cannot appear here — there is nothing to be near.
      </EmptyRow>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((b) => {
        const fill = Math.min(1, b.ceilingCents === 0 ? 0 : b.peakCents / b.ceilingCents);
        return (
          <li
            key={b.workflowId}
            className="border-status-waiting-border bg-surface-raised rounded-md border p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Text variant="body-sm" tone="max" className="max-w-[32ch] truncate font-medium">
                {b.workflowName}
              </Text>
              <Text variant="caption" tone="secondary" tabular>
                {b.nearCeiling.toLocaleString()} of {b.runs.toLocaleString()} runs
                ({b.sharePct}%) finished above 85% of the ceiling
              </Text>
            </div>

            <div className="mt-2 flex items-center gap-3">
              {/*
                The bar is peak against ceiling, with the 85% threshold marked.

                The threshold is a NOTCH that overhangs the track, not a line
                inside it. Every row on this list is past 85% by definition, so a
                line drawn within the bar is always underneath the fill — where a
                1px grey mark on an amber bar reads as nothing at all. Overhanging
                it keeps the reference visible whichever side of it the fill ends.
              */}
              <span className="relative h-2 flex-1">
                <span className="bg-surface-sunken absolute inset-0 overflow-hidden rounded-full">
                  <span
                    className="bg-status-waiting block h-full rounded-full"
                    style={{ width: `${fill * 100}%` }}
                  />
                </span>
                <span
                  className="bg-fg-max absolute -top-1 -bottom-1 w-0.5 rounded-full"
                  style={{ left: "85%" }}
                  aria-hidden
                />
              </span>
              <Text variant="caption" tone="secondary" tabular className="shrink-0">
                peak {formatCostCents(b.peakCents)} of {formatCostCents(b.ceilingCents)}
              </Text>
              <SampleRunLink runId={b.sampleRunId} label="Debug" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── The page ────────────────────────────────────────────────────────────────

export interface FailuresViewProps {
  data: FailureRollup;
  window: FailureWindow;
  onWindow: (w: FailureWindow) => void;
  /** True while a window change is in flight — the data below is the old window. */
  refreshing?: boolean;
}

export function FailuresView({ data, window: win, onWindow, refreshing }: FailuresViewProps) {
  const [grouping, setGrouping] = React.useState<Grouping>("workflow");
  const c = data.traceCompleteness;

  return (
    <div className={cn(refreshing && "opacity-60 transition-opacity motion-reduce:transition-none")}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Text variant="heading-lg" tone="max" as="h1">Failures</Text>
          <Text variant="body-sm" tone="secondary" className="mt-1 block max-w-[68ch]">
            Every failed run in the window, in exactly one class. Grouped by who
            has to fix it.
          </Text>
        </div>

        <div className="flex items-center gap-4">
          <div>
            <Text variant="display-md" tone="max" tabular as="p" className="leading-none">
              {data.totalFailures.toLocaleString()}
            </Text>
            <Text variant="caption" tone="muted" className="mt-1 block">
              failures in {WINDOWS.find((w) => w.key === win)?.full.toLowerCase()}
            </Text>
          </div>

          <div
            role="tablist"
            aria-label="Window"
            className="border-subtle flex gap-0.5 rounded-md border p-0.5"
          >
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                role="tab"
                aria-selected={win === w.key}
                aria-label={w.full}
                onClick={() => onWindow(w.key)}
                className={cn(
                  "rounded-xs px-2.5 py-1 text-xs tabular",
                  "transition-opacity hover:opacity-80 motion-reduce:transition-none",
                  "focus-visible:focus-ring",
                  win === w.key
                    ? "bg-surface-selected text-fg-max font-medium"
                    : "text-fg-secondary",
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 7 — first, but ONLY when it undermines everything below it. The quiet
          form of the same fact is at the foot of the page. */}
      {c.undermines ? <Completeness c={c} prominent /> : null}

      <Section
        id="failures-owners"
        title="Whose queue"
        hint="The same failures, split by who can act on them. Config and input are
              the workflow builder's; auth is the workspace admin's; infra is the
              platform's. Nobody has to read past their own card."
      >
        <OwnerQueues owners={data.byOwner} total={data.totalFailures} />
      </Section>

      <Section
        id="failures-classes"
        title="By class"
        hint="Every failed run appears in exactly one row. Trend compares against the
              same length of time immediately before this window."
        count={data.byClass.length}
      >
        <ClassTable rows={data.byClass} />
      </Section>

      <Section
        id="failures-recurring"
        title="Recurring causes"
        hint="The same tool, credential or agent failing repeatedly, ranked and
              collapsed. Forty runs blocked by one expired credential are one row."
        count={data.recurring.length}
      >
        <Recurring rows={data.recurring} />
      </Section>

      <section aria-labelledby="failures-grouped" className="mt-8">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
          <Text variant="heading-sm" tone="max" as="h2" id="failures-grouped">
            Where they happen
          </Text>
          <div role="tablist" aria-label="Group by" className="flex gap-1">
            {([
              ["workflow", "By workflow", TreeStructure],
              ["agent", "By agent", Robot],
            ] as const).map(([key, label, icon]) => (
              <button
                key={key}
                role="tab"
                aria-selected={grouping === key}
                onClick={() => setGrouping(key)}
                className={cn(
                  "rounded-xs inline-flex items-center gap-1.5 px-2 py-0.5 text-xs",
                  "transition-opacity hover:opacity-80 motion-reduce:transition-none",
                  "focus-visible:focus-ring",
                  grouping === key
                    ? "bg-surface-selected text-fg-max font-medium"
                    : "text-fg-secondary",
                )}
              >
                <Icon icon={icon} size="xs" decorative />
                {label}
              </button>
            ))}
          </div>
        </div>
        <Text variant="body-sm" tone="secondary" className="mb-3 block max-w-[76ch]">
          {grouping === "workflow"
            ? "One bad prompt is a pattern here, not forty separate tickets. Worst twenty."
            : "Read from activations, not runs: a run activates several agents and only " +
              "one of them failed. Worst twenty."}
        </Text>
        <GroupedTable grouping={grouping} workflows={data.byWorkflow} agents={data.byAgent} />
      </section>

      <Section
        id="failures-budget"
        title="Budget pressure"
        hint="These runs succeeded. They are here because a workflow that regularly
              finishes above 85% of its ceiling is about to start failing, and this
              is the cheap moment to change it."
        count={data.budgetPressure.length}
      >
        <BudgetPressure rows={data.budgetPressure} />
      </Section>

      {/* 7 again — the quiet form, when completeness is not a problem. */}
      {!c.undermines ? <Completeness c={c} prominent={false} /> : null}
    </div>
  );
}
