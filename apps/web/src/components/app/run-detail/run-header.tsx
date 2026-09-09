"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { MonoId } from "~/components/ui/mono-id";
import { CheckpointRibbon } from "~/components/app/ribbon/checkpoint-ribbon";
import { formatCost, formatDuration, formatTokens, EMPTY } from "~/lib/format";
import { POLICY } from "~/mocks/control";
import { useReplay } from "./replay";
import type { Run } from "~/lib/runs/model";

/* ══════════════════════════════════════════════════════════════════════════════
   RUN HEADER — status, identity, metadata, actions, and the Ribbon at lg.

   THE RIBBON IS THE SPINE, not a status bar. It is full width, interactive, and
   dragging it drives every pane at once (§7.2 #7). Which is why it sits between
   the metadata and the panes rather than inside one of them — it belongs to all
   four.

   The metadata row states cost against budget rather than in isolation. $0.0031
   is a number; $0.0031 of a $12.00 daily budget is a judgement.
══════════════════════════════════════════════════════════════════════════════ */

const STATUS_STYLE: Record<Run["status"], string> = {
  succeeded: "text-status-success border-status-success-border bg-status-success-subtle",
  failed: "text-status-failed border-status-failed-border bg-status-failed-subtle",
  running: "text-status-live border-status-live-border bg-status-live-subtle",
  queued: "text-status-queued border-status-queued-border bg-status-queued-subtle",
  "awaiting-approval": "text-status-waiting border-status-waiting-border bg-status-waiting-subtle",
  /* Same ramp as awaiting-approval: both are waiting, and the ramp is six hues
     by design. The LABEL carries the difference — a person versus a machine. */
  waiting: "text-status-waiting border-status-waiting-border bg-status-waiting-subtle",
  cancelled: "text-status-cancelled border-status-cancelled-border bg-status-cancelled-subtle",
};

const STATUS_LABEL: Record<Run["status"], string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  running: "Running",
  queued: "Queued",
  "awaiting-approval": "Awaiting approval",
  waiting: "Waiting",
  cancelled: "Cancelled",
};

const ENV_STYLE: Record<Run["environment"], string> = {
  production: "text-status-failed border-status-failed-border",
  staging: "text-status-waiting border-status-waiting-border",
  development: "text-fg-muted border-subtle",
  // A run whose environment the API did not name. Drawn like development
  // rather than like production: guessing "production" on a run we cannot
  // place would put a red badge on something that may be harmless.
  unknown: "text-fg-muted border-subtle",
};

export interface RunHeaderProps {
  run: Run;
  retryCostUsd: number | null;
  onCancel: () => void;
  cancelling: boolean;
  cancelError: string | null;
  onCompare: () => void;
  comparing: boolean;
  /**
   * Re-run the failed step only, and then everything after it.
   *
   * Separate from [onRetryRun] because they cost differently and mean
   * differently: one resumes, the other starts again and pays for the steps
   * that already succeeded. The header shows the price of the first for exactly
   * that reason.
   */
  onRetryStep: (nodeId: string) => void;
  /** Re-run the whole workflow from the trigger. */
  onRetryRun: () => void;
  retrying: boolean;
  retryError: string | null;
}

export function RunHeader({
  run, retryCostUsd, onCancel, cancelling, cancelError, onCompare, comparing,
  onRetryStep, onRetryRun, retrying, retryError,
}: RunHeaderProps) {
  const { setScrub, select, focusIndex, scrubbing } = useReplay();
  /*
   * The step "Retry failed step" actually retries.
   *
   * The button was rendered whenever the RUN was failed and carried no handler
   * at all, so it was an affordance that did nothing — the reported symptom.
   * Wiring it needs a node, and the node is the first failed one: a run stops at
   * its first failure, so a second failed node only exists on parallel branches,
   * where the first in graph order is still the one to resume from.
   *
   * Null when the run failed with no failed NODE — an infrastructure failure
   * before any step ran. There is nothing to retry from, so the button does not
   * render and "Retry from start" is the honest offer.
   */
  const failedNode = run.nodes.find((n) => n.state === "failed") ?? null;

  /*
   * Match the API, which accepts `waiting_for_approval` too.
   *
   * The UI offered Cancel only on `running` and `queued`, so a run parked on an
   * approval — the state most likely to need cancelling, because it can sit
   * there for days — had no way to stop from this screen even though
   * `POST /api/runs/:id/cancel` would have accepted it.
   */
  const cancellable =
    run.status === "running" ||
    run.status === "queued" ||
    /* The UI's own spelling. `RunStatus` normalises the API's
       `waiting_for_approval` to `awaiting-approval`, and comparing against the
       API's wording here compiled to a constant false — a gate that silently
       never opens is worse than the one it was meant to widen. */
    run.status === "awaiting-approval";

  const [copied, setCopied] = React.useState(false);

  /**
   * The run, as a file.
   *
   * The button had no handler at all. Built from the run already in memory
   * rather than by refetching: this is the same object every other panel on the
   * page is rendering, so what lands in the file is what the reader was looking
   * at — and an export that disagrees with the screen is worse than none.
   *
   * The object URL is revoked immediately; the browser has already read it by
   * the time `click()` returns, and leaving it would pin the blob for the life
   * of the document.
   */
  const exportRun = React.useCallback(() => {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-${run.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [run]);

  const copyLink = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      /* Clipboard permission denied, or an insecure origin. The URL is in the
         address bar either way, so there is nothing to recover and nothing
         worth interrupting the reader about. */
    }
  }, []);

  const recovered = run.nodes.filter((n) => n.state === "recovered").length;
  const retries = run.nodes.reduce((sum, n) => sum + ((n.attempt ?? 1) - 1), 0);
  const budgetShare = (run.costUsd / POLICY.dailyBudgetUsd) * 100;

  /*
   * THE SPINE DID NOT SAY WHAT WAS RUNNING.
   *
   * The Ribbon renders `executing` as a breathing cell — the same treatment the
   * marketing recovery loop uses — but the worker never wrote that state, so a
   * live run showed a row of committed cells followed by empty outlines and the
   * caption above it read "Drag to replay" while the run was still moving. The
   * worker now records `executing` on entry to every node
   * (`WorkflowRuntime.executeSingleNode`), and this is the caption that names it:
   * the cell answers "where", the line answers "what".
   */
  const executingIndex = run.nodes.findIndex((node) => node.state === "executing");
  const executing = executingIndex >= 0 ? run.nodes[executingIndex] : null;
  const gatedIndex = run.nodes.findIndex((node) => node.state === "gated");

  return (
    <header className="grid gap-3">
      {/* ── Identity ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "font-ui text-caption inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                STATUS_STYLE[run.status],
              )}
            >
              {run.status === "running" ? (
                <span
                  aria-hidden="true"
                  data-motion="decorative"
                  className="bg-status-live size-1.5 rounded-full motion-safe:animate-[ink-bloom_2s_ease-in-out_infinite]"
                />
              ) : null}
              {STATUS_LABEL[run.status]}
            </span>

            <Text variant="heading-md" tone="max" as="h1" className="min-w-0 truncate">
              {run.workflowName}
            </Text>

            <span className={cn("font-ui text-caption rounded-sm border px-1.5 py-0.5", ENV_STYLE[run.environment])}>
              {run.environment}
            </span>
          </div>

          <div className="mt-1.5">
            <MonoId value={run.id} head={12} tail={8} srLabel="Run identifier" />
          </div>
        </div>

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-1.5">
          {run.status === "failed" && failedNode ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onRetryStep(failedNode.id)}
              loading={retrying}
              loadingLabel="Retrying the failed step"
            >
              Retry failed step
              {retryCostUsd !== null ? (
                <span className="tabular opacity-80">· {formatCost(retryCostUsd)}</span>
              ) : null}
            </Button>
          ) : null}
          {cancellable ? (
            <Button
              size="sm"
              variant="danger"
              onClick={onCancel}
              loading={cancelling}
              loadingLabel="Cancelling run"
            >
              Cancel
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={onRetryRun}
            loading={retrying}
            loadingLabel="Starting the run again"
          >
            Retry from start
          </Button>
          <Button size="sm" variant={comparing ? "subtle" : "secondary"} onClick={onCompare} aria-pressed={comparing}>
            Compare
          </Button>
          {/*
            THE DEBUG TAB'S ONLY ENTRY POINT.

            The route, its three views and its API have existed since P5, and
            nobody could reach any of it: `/runs/:id/debug` was linked from
            nowhere — not here, not the nav, not the command palette — so it was
            reachable only by typing the URL. A feature with no door is a feature
            that does not exist, however complete the room behind it.

            It sits beside "Open workflow" rather than in the pane strip because
            it is a different MODE of looking at one run, not a fourth pane —
            which is the same reason it has its own address (see the route's own
            note on panes-not-tabs).
          */}
          <Button asChild size="sm" variant="secondary">
            <Link href={`/runs/${run.id}/debug` as Route}>Debug</Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/workflows/${run.workflowId}` as Route}>Open workflow</Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label="Export run"
            onClick={exportRun}
          >
            <DownloadGlyph />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label={copied ? "Link copied" : "Copy link to this run"}
            onClick={() => void copyLink()}
          >
            <ShareGlyph />
          </Button>
          {/* The confirmation lives here rather than in a toast: the click was
              on this row and the eye is already on it. */}
          {copied ? (
            <Text variant="caption" tone="secondary" aria-live="polite">Link copied</Text>
          ) : null}
          {retryError ? (
            <Text variant="caption" tone="secondary" className="block text-status-failed">
              {retryError}
            </Text>
          ) : null}
          {cancelError ? (
            <Text variant="caption" tone="inherit" className="text-status-failed" role="alert">
              {cancelError}
            </Text>
          ) : null}
        </div>
      </div>

      {/* ── Metadata ───────────────────────────────────────────────────────── */}
      <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
        <Meta label="Started">{new Date(run.startedAt).toISOString().replace("T", " ").slice(0, 19)}Z</Meta>
        <Meta label="Duration">{formatDuration(run.durationMs)}</Meta>
        <Meta label="Trigger">{run.trigger}</Meta>
        <Meta label="Version">v{(run.workflowId.charCodeAt(3) % 9) + 1}</Meta>
        <Meta label="Queue">default</Meta>
        <Meta label="Retries">{retries}</Meta>
        <Meta label="Recovered">
          {recovered > 0 ? <span className="text-status-success">{recovered}</span> : recovered}
        </Meta>
        <Meta label="Tokens">{run.tokens ? formatTokens(run.tokens) : EMPTY}</Meta>
        <Meta label="Cost">
          {formatCost(run.costUsd)}
          <span className="text-fg-muted"> of {formatCost(POLICY.dailyBudgetUsd)} budget ({budgetShare.toFixed(1)}%)</span>
        </Meta>
      </dl>

      {/* ── The spine ──────────────────────────────────────────────────────── */}
      <div className="border-subtle bg-surface-raised rounded-lg border p-3">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <Text variant="eyebrow" tone="muted">Checkpoints</Text>
          {scrubbing ? (
            <Text variant="caption" tone="accent" aria-live="polite">
              Replaying step <span className="tabular">{focusIndex + 1}</span> of{" "}
              <span className="tabular">{run.nodes.length}</span> ·{" "}
              {run.nodes[focusIndex]?.name}
            </Text>
          ) : executing ? (
            /* The live line. Same vocabulary as the cell beneath it — the cell
               breathes, this names the step it belongs to — so the two cannot
               disagree about which node the run is on. */
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                data-motion="decorative"
                className="bg-status-live size-1.5 shrink-0 rounded-full motion-safe:animate-[ink-bloom_2s_ease-in-out_infinite]"
              />
              <Text variant="caption" tone="inherit" className="text-status-live" aria-live="polite">
                Running step <span className="tabular">{executingIndex + 1}</span> of{" "}
                <span className="tabular">{run.nodes.length}</span> · {executing.name}
              </Text>
            </span>
          ) : gatedIndex >= 0 ? (
            <Text variant="caption" tone="inherit" className="text-status-waiting" aria-live="polite">
              Waiting for a decision at step <span className="tabular">{gatedIndex + 1}</span> ·{" "}
              {run.nodes[gatedIndex]?.name}
            </Text>
          ) : run.status === "running" || run.status === "queued" ? (
            /* Live, but no cell has claimed `executing` yet — the gap between the
               run being claimed and its first node reporting, and every run that
               predates the worker writing the state at all. Saying so beats
               inventing a step, and beats "drag to replay" on a moving run. */
            <Text variant="caption" tone="muted" aria-live="polite">
              {run.status === "queued"
                ? "Queued · no step has started yet"
                : "Running · waiting for the next step to report"}
            </Text>
          ) : (
            <Text variant="caption" tone="muted">
              Drag to replay · click a cell to inspect that step
            </Text>
          )}
        </div>

        <CheckpointRibbon
          nodes={run.nodes}
          size="lg"
          runId={run.id}
          interactive
          showLabels
          onScrub={setScrub}
          onCellClick={(_, index) => select(index)}
        />
      </div>
    </header>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd><Text variant="caption" tone="primary" tabular>{children}</Text></dd>
    </div>
  );
}

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true" fill="none">
      <path d="M7 2v7m0 0 2.6-2.6M7 9 4.4 6.4M2.5 11.5h9" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareGlyph() {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden="true" fill="none">
      <path d="M5.8 8.2 8.2 5.8M6 3.4 7.2 2.2a2.4 2.4 0 0 1 3.4 3.4L9.4 6.8M8 10.6 6.8 11.8a2.4 2.4 0 0 1-3.4-3.4L4.6 7.2" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
