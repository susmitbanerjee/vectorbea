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
import type { Run } from "~/mocks/domain";

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
  cancelled: "text-status-cancelled border-status-cancelled-border bg-status-cancelled-subtle",
};

const STATUS_LABEL: Record<Run["status"], string> = {
  succeeded: "Succeeded",
  failed: "Failed",
  running: "Running",
  queued: "Queued",
  "awaiting-approval": "Awaiting approval",
  cancelled: "Cancelled",
};

const ENV_STYLE: Record<Run["environment"], string> = {
  production: "text-status-failed border-status-failed-border",
  staging: "text-status-waiting border-status-waiting-border",
  development: "text-fg-muted border-subtle",
};

export interface RunHeaderProps {
  run: Run;
  retryCostUsd: number | null;
  onCompare: () => void;
  comparing: boolean;
}

export function RunHeader({ run, retryCostUsd, onCompare, comparing }: RunHeaderProps) {
  const { setScrub, select, focusIndex, scrubbing } = useReplay();
  const recovered = run.nodes.filter((n) => n.state === "recovered").length;
  const retries = run.nodes.reduce((sum, n) => sum + ((n.attempt ?? 1) - 1), 0);
  const budgetShare = (run.costUsd / POLICY.dailyBudgetUsd) * 100;

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
          {run.status === "failed" ? (
            <Button size="sm" variant="primary">
              Retry failed step
              {retryCostUsd !== null ? (
                <span className="tabular opacity-80">· {formatCost(retryCostUsd)}</span>
              ) : null}
            </Button>
          ) : null}
          {run.status === "running" || run.status === "queued" ? (
            <Button size="sm" variant="danger">Cancel</Button>
          ) : null}
          <Button size="sm" variant="secondary">Retry from start</Button>
          <Button size="sm" variant={comparing ? "subtle" : "secondary"} onClick={onCompare} aria-pressed={comparing}>
            Compare
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/workflows/${run.workflowId}` as Route}>Open workflow</Link>
          </Button>
          <Button size="sm" variant="ghost" iconOnly aria-label="Export run">
            <DownloadGlyph />
          </Button>
          <Button size="sm" variant="ghost" iconOnly aria-label="Copy link to this run">
            <ShareGlyph />
          </Button>
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
          <Text variant="caption" tone={scrubbing ? "accent" : "muted"} aria-live="polite">
            {scrubbing ? (
              <>
                Replaying step <span className="tabular">{focusIndex + 1}</span> of{" "}
                <span className="tabular">{run.nodes.length}</span> ·{" "}
                {run.nodes[focusIndex]?.name}
              </>
            ) : (
              "Drag to replay · click a cell to inspect that step"
            )}
          </Text>
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
