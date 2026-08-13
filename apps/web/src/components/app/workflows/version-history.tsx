"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { Route } from "next";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { formatCost, formatDuration, formatPercent } from "~/lib/format";
import {
  versionsFor, diffVersions, summariseDiff, diffState, overlayGraph,
  compareReliability,
  type WorkflowVersion, type VersionDiff,
} from "~/mocks/workflow-versions";
import { VersionGraph, GraphLegend, type NodePaint } from "./graph-canvas";
import { ConfigDiff } from "./config-diff";
import { RelativeTime } from "./atoms";
import type { Workflow } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   VERSION HISTORY

   The capability the product implies and never shows: the builder displays "V1"
   and a History button with nothing behind it.

   THE TIMELINE CARRIES RELIABILITY, NOT JUST AUTHORSHIP. Who changed what and
   when is a changelog; how many runs each version survived is the thing that
   makes a version history operationally useful. It is what turns "v6 raised the
   timeout" into "v6 raised the timeout and success went from 86% to 21%".

   THE DIFF IS THE PRODUCT. Two versions, three views of the difference: the
   graph (what moved), the config (what changed inside), and one English sentence
   generated from both so they cannot disagree.
══════════════════════════════════════════════════════════════════════════════ */

type DiffMode = "side-by-side" | "overlay";

export function VersionHistory({ workflow }: { workflow: Workflow }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const versions = React.useMemo(() => versionsFor(workflow.id), [workflow.id]);

  /* Selection lives in the URL: a diff between two versions is exactly the kind
     of thing somebody pastes into an incident channel. */
  const baseNumber = Number(params.get("a") ?? versions[1]?.number ?? versions[0]?.number ?? 1);
  const headNumber = Number(params.get("b") ?? versions[0]?.number ?? 1);
  const mode = (params.get("mode") as DiffMode | null) ?? "side-by-side";

  const setParams = React.useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
    },
    [params, pathname, router],
  );

  const base = versions.find((v) => v.number === baseNumber) ?? versions[versions.length - 1];
  const head = versions.find((v) => v.number === headNumber) ?? versions[0];

  const diff = React.useMemo(
    () => (base && head ? diffVersions(base.nodes, head.nodes) : null),
    [base, head],
  );

  const [selectedNode, setSelectedNode] = React.useState<string | null>(null);
  const [restoring, setRestoring] = React.useState<WorkflowVersion | null>(null);

  // Reset the node selection whenever the comparison changes: keeping a node
  // selected across a diff change leaves an expanded config panel describing a
  // node that may not exist in either version any more.
  React.useEffect(() => { setSelectedNode(null); }, [baseNumber, headNumber]);

  if (versions.length === 0 || !base || !head || !diff) {
    return (
      <PageContainer>
        <PageHeader title="Version history" description={workflow.name} />
        <Text variant="body-sm" tone="muted">This workflow has no versions yet.</Text>
      </PageContainer>
    );
  }

  const reliability = compareReliability(base, head);
  const summary = summariseDiff(diff);
  const changedCount = diff.added.length + diff.removed.length + diff.modified.length;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={
          <Link
            href={`/workflows/${workflow.id}` as Route}
            className="hover:text-fg-secondary rounded-xs outline-none transition-colors duration-fast focus-visible:focus-ring"
          >
            Build · Workflows · {workflow.name}
          </Link>
        }
        title="Version history"
        description={`Every publish of ${workflow.name} is an immutable record. Restoring one creates a new draft — history is never overwritten.`}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/workflows/${workflow.id}` as Route}>Back to overview</Link>
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <Timeline
          versions={versions}
          base={base}
          head={head}
          onCompare={(a, b) => setParams({ a: String(a), b: String(b) })}
          onRestore={setRestoring}
        />

        <div className="grid min-w-0 gap-4">
          <DiffSummary
            base={base}
            head={head}
            summary={summary}
            changedCount={changedCount}
            diff={diff}
          />

          <ReliabilityCard comparison={reliability} />

          <GraphDiff
            base={base}
            head={head}
            diff={diff}
            mode={mode}
            onModeChange={(next) => setParams({ mode: next })}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
          />

          <NodeDiffList
            base={base}
            head={head}
            diff={diff}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
          />
        </div>
      </div>

      <RestoreDialog
        workflow={workflow}
        version={restoring}
        latest={versions[0]}
        onClose={() => setRestoring(null)}
      />
    </PageContainer>
  );
}

/* ── Timeline ─────────────────────────────────────────────────────────────── */

function Timeline({
  versions, base, head, onCompare, onRestore,
}: {
  versions: WorkflowVersion[];
  base: WorkflowVersion;
  head: WorkflowVersion;
  onCompare: (a: number, b: number) => void;
  onRestore: (version: WorkflowVersion) => void;
}) {
  return (
    <section className="bg-surface-raised border-subtle min-w-0 rounded-lg border">
      <header className="border-subtle flex items-center justify-between gap-2 border-b px-3 py-2">
        <Text variant="eyebrow" tone="muted">Versions</Text>
        <Text variant="caption" tone="disabled">{versions.length}</Text>
      </header>

      <ol className="grid gap-px p-2">
        {versions.map((version) => {
          const isBase = version.number === base.number;
          const isHead = version.number === head.number;

          return (
            <li key={version.id}>
              <div
                className={cn(
                  "relative grid gap-1 rounded-md border p-2",
                  isBase || isHead ? "border-accent-border bg-surface-selected" : "border-transparent",
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <Text variant="body-sm" tone="max" tabular className="font-medium">
                    v{version.number}
                  </Text>
                  {version.published ? (
                    version.publishedTo ? (
                      <Text variant="caption" tone="muted">published to {version.publishedTo}</Text>
                    ) : null
                  ) : (
                    <Text variant="caption" tone="inherit" className="text-status-waiting">draft</Text>
                  )}
                  {isBase ? <Marker>base</Marker> : null}
                  {isHead ? <Marker>compare</Marker> : null}
                  <Text variant="caption" tone="disabled" className="ml-auto shrink-0">
                    <RelativeTime iso={version.at} />
                  </Text>
                </div>

                <Text variant="caption" tone="secondary" className="break-words">
                  {version.changeSummary}
                </Text>

                {version.note ? (
                  <Text variant="caption" tone="muted" className="border-subtle break-words border-l-2 pl-2 italic">
                    {version.note}
                  </Text>
                ) : null}

                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <Text variant="caption" tone="disabled">{version.author}</Text>
                  {/* Reliability per version is what makes this a history worth
                      opening rather than a changelog. */}
                  {version.runCount > 0 ? (
                    <Text variant="caption" tone="disabled" tabular>
                      {version.runCount} {version.runCount === 1 ? "run" : "runs"} ·{" "}
                      <span className={version.successRate >= 90 ? "text-status-success" : version.successRate >= 60 ? "text-status-waiting" : "text-status-failed"}>
                        {formatPercent(version.successRate)}
                      </span>
                    </Text>
                  ) : (
                    <Text variant="caption" tone="disabled">never ran</Text>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={isBase}
                    onClick={() => onCompare(version.number, head.number)}
                  >
                    Set as base
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={isHead}
                    onClick={() => onCompare(base.number, version.number)}
                  >
                    Compare
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => onRestore(version)}>
                    Restore
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Marker({ children }: { children: React.ReactNode }) {
  return (
    <span className="border-accent-border text-accent font-ui rounded-xs border px-1 text-[10px] uppercase">
      {children}
    </span>
  );
}

/* ── Summary ──────────────────────────────────────────────────────────────── */

function DiffSummary({
  base, head, summary, changedCount, diff,
}: {
  base: WorkflowVersion;
  head: WorkflowVersion;
  summary: string;
  changedCount: number;
  diff: VersionDiff;
}) {
  return (
    <section className="bg-surface-raised border-subtle rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <Text variant="heading-sm" tone="max" as="h2">
          v{base.number} → v{head.number}
        </Text>
        <Text variant="caption" tone="muted">
          {base.number === head.number ? "the same version" : `${changedCount} of ${head.nodes.length} nodes affected`}
        </Text>
      </div>

      {/* Generated from the diff, never authored — the sentence and the graph
          below it are computed from one call, so they cannot disagree. */}
      <Text variant="body" tone="primary" className="mt-1.5 block">{summary}</Text>

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        <Count label="Added" value={diff.added.length} tone="text-status-success" />
        <Count label="Removed" value={diff.removed.length} tone="text-status-failed" />
        <Count label="Modified" value={diff.modified.length} tone="text-status-waiting" />
        <Count label="Unchanged" value={diff.unchanged.length} tone="text-fg-disabled" />
        {diff.moved.length > 0 ? (
          <Count label="Moved" value={diff.moved.length} tone="text-fg-muted" />
        ) : null}
      </dl>
    </section>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd><Text variant="body-sm" tone="inherit" tabular className={tone}>{value}</Text></dd>
    </div>
  );
}

/* ── Reliability ──────────────────────────────────────────────────────────── */

function ReliabilityCard({ comparison }: { comparison: ReturnType<typeof compareReliability> }) {
  const { a, b, verdict, sentence, durationDelta, spendDelta } = comparison;

  const tone =
    verdict === "better" ? "border-status-success-border bg-status-success-subtle"
      : verdict === "worse" ? "border-status-failed-border bg-status-failed-subtle"
        : "border-subtle bg-surface-raised";

  return (
    <section className={cn("rounded-lg border p-3", tone)}>
      <Text variant="eyebrow" tone="muted" className="block">Did the change help?</Text>
      <Text variant="body-sm" tone="primary" className="mt-1 block">{sentence}</Text>

      {verdict !== null ? (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          <Delta
            label="Success rate"
            value={`${comparison.successRateDelta > 0 ? "+" : ""}${comparison.successRateDelta} pts`}
            good={comparison.successRateDelta >= 0}
          />
          <Delta
            label="Avg duration"
            value={durationDelta === 0 ? "no change" : `${durationDelta > 0 ? "+" : "−"}${formatDuration(Math.abs(durationDelta))}`}
            good={durationDelta <= 0}
          />
          {/* Spend carries no verdict. A version that ran more often costs more
              without being worse, and painting that red would make the card
              argue for a conclusion the numbers do not support. */}
          <Delta
            label="Spend on version"
            value={`${formatCost(a.spendUsd)} → ${formatCost(b.spendUsd)}`}
            good={null}
            note={spendDelta === 0 ? undefined : `${spendDelta > 0 ? "+" : "−"}${formatCost(Math.abs(spendDelta))}`}
          />
        </dl>
      ) : null}
    </section>
  );
}

/** `good: null` means the metric carries no verdict and stays neutral. */
function Delta({
  label, value, good, note,
}: {
  label: string;
  value: string;
  good: boolean | null;
  note?: string;
}) {
  return (
    <div>
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd className="flex items-baseline gap-1.5">
        <Text
          variant="body-sm"
          tone={good === null ? "primary" : "inherit"}
          tabular
          className={good === null ? undefined : good ? "text-status-success" : "text-status-failed"}
        >
          {value}
        </Text>
        {note ? <Text variant="caption" tone="muted" tabular>{note}</Text> : null}
      </dd>
    </div>
  );
}

/* ── Graph diff ───────────────────────────────────────────────────────────── */

function GraphDiff({
  base, head, diff, mode, onModeChange, selectedNode, onSelectNode,
}: {
  base: WorkflowVersion;
  head: WorkflowVersion;
  diff: VersionDiff;
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const paint = React.useCallback(
    (node: { id: string }): NodePaint => diffState(diff, node.id),
    [diff],
  );

  const overlay = React.useMemo(
    () => overlayGraph(base.nodes, head.nodes, diff),
    [base.nodes, head.nodes, diff],
  );

  return (
    <section className="bg-surface-raised border-subtle rounded-lg border">
      <header className="border-subtle flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <Text variant="eyebrow" tone="muted">Graph diff</Text>
        <div className="flex items-center gap-2">
          <GraphLegend states={["added", "removed", "modified", "unchanged"]} />
          <ModeToggle value={mode} onChange={onModeChange} />
        </div>
      </header>

      <div className="p-3">
        {mode === "side-by-side" ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="min-w-0">
              <Text variant="caption" tone="muted" className="mb-1 block">
                v{base.number} — before
              </Text>
              <VersionGraph
                nodes={base.nodes}
                paint={paint}
                selectedId={selectedNode}
                onSelect={(node) => onSelectNode(node.id)}
                label={`Version ${base.number} graph`}
                height={260}
              />
            </div>
            <div className="min-w-0">
              <Text variant="caption" tone="muted" className="mb-1 block">
                v{head.number} — after
              </Text>
              <VersionGraph
                nodes={head.nodes}
                paint={paint}
                selectedId={selectedNode}
                onSelect={(node) => onSelectNode(node.id)}
                label={`Version ${head.number} graph`}
                height={260}
              />
            </div>
          </div>
        ) : (
          <>
            <VersionGraph
              nodes={overlay.nodes.map((n) => n.node)}
              paint={paint}
              selectedId={selectedNode}
              onSelect={(node) => onSelectNode(node.id)}
              label={`Versions ${base.number} and ${head.number} overlaid`}
              height={280}
            />
            {/* The overlay keeps removed nodes in position rather than dropping
                them — an overlay without them is just the "after" graph, which
                is the one comparison that tells you nothing. */}
            <Text variant="caption" tone="muted" className="mt-2 block">
              Removed nodes are drawn dashed where they used to sit, so the sequence still reads.
            </Text>
          </>
        )}
      </div>
    </section>
  );
}

function ModeToggle({ value, onChange }: { value: DiffMode; onChange: (mode: DiffMode) => void }) {
  return (
    <div role="group" aria-label="Diff mode" className="border-subtle flex items-center gap-0.5 rounded-md border p-0.5">
      {(["side-by-side", "overlay"] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          aria-pressed={value === mode}
          className={cn(
            "font-ui text-caption rounded-xs px-2 py-0.5",
            "transition-colors duration-fast outline-none focus-visible:focus-ring",
            value === mode ? "bg-surface-active text-fg-primary" : "text-fg-muted hover:text-fg-primary",
          )}
        >
          {mode === "side-by-side" ? "Side by side" : "Overlay"}
        </button>
      ))}
    </div>
  );
}

/* ── Per-node config diff ─────────────────────────────────────────────────── */

function NodeDiffList({
  base, head, diff, selectedNode, onSelectNode,
}: {
  base: WorkflowVersion;
  head: WorkflowVersion;
  diff: VersionDiff;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const changed = [...diff.added, ...diff.modified, ...diff.removed];
  const beforeById = React.useMemo(() => new Map(base.nodes.map((n) => [n.id, n])), [base.nodes]);
  const afterById = React.useMemo(() => new Map(head.nodes.map((n) => [n.id, n])), [head.nodes]);

  if (changed.length === 0) {
    return (
      <section className="bg-surface-raised border-subtle rounded-lg border p-3">
        <Text variant="eyebrow" tone="muted" className="block">Config diff</Text>
        <Text variant="body-sm" tone="muted" className="mt-1 block">
          These two versions are identical. Nothing was added, removed or reconfigured.
        </Text>
      </section>
    );
  }

  return (
    <section className="bg-surface-raised border-subtle rounded-lg border">
      <header className="border-subtle flex items-center justify-between gap-2 border-b px-3 py-2">
        <Text variant="eyebrow" tone="muted">Config diff</Text>
        <Text variant="caption" tone="disabled">
          {changed.length} {changed.length === 1 ? "node" : "nodes"}
        </Text>
      </header>

      <ul className="grid gap-px p-2">
        {changed.map((id) => {
          const state = diffState(diff, id);
          const open = selectedNode === id;
          const before = beforeById.get(id) ?? null;
          const after = afterById.get(id) ?? null;

          return (
            <li key={id}>
              <button
                onClick={() => onSelectNode(open ? null : id)}
                aria-expanded={open}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left",
                  "hover:bg-surface-hover transition-colors duration-fast",
                  "outline-none focus-visible:focus-ring",
                  open && "bg-surface-hover",
                )}
              >
                <StateChip state={state} />
                <span className="font-ui text-body-sm text-fg-primary min-w-0 truncate">
                  {diff.names[id]}
                </span>
                <span className="font-code text-mono-sm text-fg-disabled ml-auto shrink-0">
                  {(after ?? before)?.kind}
                </span>
                <svg
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  className={cn(
                    "text-fg-disabled size-3 shrink-0 transition-transform duration-fast",
                    open && "rotate-90",
                  )}
                >
                  <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {open ? (
                <div className="border-subtle ml-2 border-l pb-2 pl-3 pt-1">
                  {state === "added" ? (
                    <Text variant="caption" tone="muted" className="mb-1.5 block">
                      New in v{head.number}. Every field below is new configuration.
                    </Text>
                  ) : state === "removed" ? (
                    <Text variant="caption" tone="muted" className="mb-1.5 block">
                      Present in v{base.number}, gone in v{head.number}. Its configuration is kept
                      here so a restore knows what to put back.
                    </Text>
                  ) : null}
                  <ConfigDiff
                    fields={diff.fields[id] ?? []}
                    before={before}
                    after={after}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const STATE_CHIP: Record<string, string> = {
  added: "text-status-success border-status-success-border bg-status-success-subtle",
  removed: "text-status-failed border-status-failed-border bg-status-failed-subtle",
  modified: "text-status-waiting border-status-waiting-border bg-status-waiting-subtle",
  unchanged: "text-fg-muted border-subtle bg-surface-sunken",
};

function StateChip({ state }: { state: string }) {
  return (
    <span className={cn("font-ui rounded-xs border px-1 text-[10px] uppercase", STATE_CHIP[state])}>
      {state}
    </span>
  );
}

/* ── Restore ──────────────────────────────────────────────────────────────── */

/**
 * Restoring creates a NEW draft. It never rewrites the version being restored
 * and never overwrites the live one.
 *
 * The alternative — restore as "make this live again" — quietly destroys the
 * record of what was running in between, which is the exact record an incident
 * review needs. A restore is an edit, and an edit produces a draft.
 */
function RestoreDialog({
  workflow, version, latest, onClose,
}: {
  workflow: Workflow;
  version: WorkflowVersion | null;
  latest: WorkflowVersion;
  onClose: () => void;
}) {
  const diff = React.useMemo(
    () => (version ? diffVersions(latest.nodes, version.nodes) : null),
    [version, latest],
  );

  return (
    <Dialog.Root open={version !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "motion-overlay z-modal fixed",
            "bg-surface-overlay border-subtle shadow-3 border",
            "inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:w-[min(32rem,calc(100vw-2rem))] sm:rounded-lg",
            "p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">
              Restore v{version?.number} as a new draft
            </Text>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text variant="body-sm" tone="secondary" className="mt-1 block">
              This creates draft v{latest.number + 1} with v{version?.number}&apos;s configuration.
              Nothing is overwritten: v{version?.number} stays exactly as it was, and whatever is
              live keeps running until you publish.
            </Text>
          </Dialog.Description>

          {diff ? (
            <div className="border-subtle mt-3 rounded-md border p-3">
              <Text variant="caption" tone="muted" className="block">
                Compared with v{latest.number}, the new draft will be:
              </Text>
              <Text variant="body-sm" tone="primary" className="mt-1 block">
                {summariseDiff(diff)}
              </Text>
            </div>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button
              asChild
              variant="primary"
              size="sm"
            >
              <Link href={`/workflows/${workflow.id}/publish?from=${version?.number}` as Route}>
                Create draft v{latest.number + 1}
              </Link>
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
