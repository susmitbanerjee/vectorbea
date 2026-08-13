"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { formatCost } from "~/lib/format";
import { estimateRetryCost } from "~/mocks/runs-scale";
import type { Run } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   BULK ACTION BAR

   Slides up from the bottom on selection. Transform only — a bar that animates
   its height reflows the table behind it on every frame.

   THE RETRY COST ESTIMATE IS THE POINT. "Retry 61 runs" is a decision made
   blind. "Retry 61 runs · 122 steps to replay, 610 already committed · about
   $0.04" is a decision. It is also the clearest place in the product to see
   what durability actually bought: the committed steps are the ones you are NOT
   paying for again.

   DESTRUCTIVE ACTIONS STATE THE COUNT. Not "are you sure" — the exact number,
   in the confirm button, so a mis-click on 3,000 selected rows is caught by
   reading rather than by luck.
══════════════════════════════════════════════════════════════════════════════ */

export interface BulkBarProps {
  selected: Run[];
  onClear: () => void;
  onRetry: (runs: Run[]) => void;
  onCancel: (runs: Run[]) => void;
  onCompare: (runs: Run[]) => void;
  onExport: (runs: Run[]) => void;
}

export function BulkBar({ selected, onClear, onRetry, onCancel, onCompare, onExport }: BulkBarProps) {
  const [confirm, setConfirm] = React.useState<null | "retry" | "cancel">(null);

  const count = selected.length;
  const estimate = React.useMemo(() => estimateRetryCost(selected), [selected]);
  const retryable = selected.filter((r) => r.status === "failed" || r.status === "cancelled");
  const cancellable = selected.filter((r) => r.status === "running" || r.status === "queued");

  if (count === 0) return null;

  return (
    <>
      <div
        role="region"
        aria-label={`${count} runs selected`}
        className={cn(
          "fixed inset-x-0 bottom-0 z-sticky flex justify-center p-3 print:hidden",
          "pointer-events-none",
        )}
      >
        <div
          data-motion="decorative"
          className={cn(
            "bg-surface-overlay border-default shadow-3 pointer-events-auto",
            "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2",
            "w-full max-w-[46rem]",
            "motion-safe:animate-[ink-drawer-in_180ms_var(--ease-standard)]",
          )}
        >
          <Text variant="body-sm" tone="primary" className="font-medium">
            <span className="tabular">{count.toLocaleString("en-GB")}</span> selected
          </Text>

          {/* The estimate lives in the bar, not behind the confirm, so it is
              visible while deciding rather than after committing. */}
          {retryable.length > 0 ? (
            <Text variant="caption" tone="muted" className="hidden md:block">
              <span className="tabular">{estimate.nodesToReplay}</span> steps to replay ·{" "}
              <span className="text-status-success tabular">{estimate.nodesSaved}</span> already committed
            </Text>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="primary"
              disabled={retryable.length === 0}
              onClick={() => setConfirm("retry")}
            >
              Retry{retryable.length !== count ? ` ${retryable.length}` : ""}
              {retryable.length > 0 ? (
                <span className="tabular opacity-80">· {formatCost(estimate.costUsd)}</span>
              ) : null}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={cancellable.length === 0}
              onClick={() => setConfirm("cancel")}
            >
              Cancel{cancellable.length !== count ? ` ${cancellable.length}` : ""}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={count !== 2}
              title={count === 2 ? "Diff these two runs" : "Select exactly two runs to compare"}
              onClick={() => onCompare(selected)}
            >
              Compare
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onExport(selected)}>
              Export
            </Button>
            <button
              onClick={onClear}
              aria-label="Clear selection"
              className={cn(
                "text-fg-muted hover:text-fg-primary grid size-7 place-items-center rounded-sm",
                "transition-colors duration-fast outline-none focus-visible:focus-ring",
              )}
            >
              <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
                <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        kind={confirm}
        retryable={retryable}
        cancellable={cancellable}
        estimate={estimate}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm === "retry") onRetry(retryable);
          if (confirm === "cancel") onCancel(cancellable);
          setConfirm(null);
        }}
      />
    </>
  );
}

function ConfirmDialog({
  kind, retryable, cancellable, estimate, onClose, onConfirm,
}: {
  kind: null | "retry" | "cancel";
  retryable: Run[];
  cancellable: Run[];
  estimate: ReturnType<typeof estimateRetryCost>;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isRetry = kind === "retry";
  const runs = isRetry ? retryable : cancellable;

  return (
    <Dialog.Root open={kind !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "motion-overlay z-modal fixed",
            "bg-surface-overlay border-subtle shadow-3 border",
            "inset-x-0 bottom-0 rounded-t-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:w-[min(30rem,calc(100vw-2rem))] sm:rounded-lg",
            "p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">
              {isRetry ? "Retry from checkpoint" : "Cancel runs"}
            </Text>
          </Dialog.Title>

          <Dialog.Description asChild>
            <Text variant="body-sm" tone="secondary" className="mt-1 block">
              {isRetry ? (
                <>
                  Each run resumes at the node that failed. Committed steps are not
                  re-executed and their side effects are not re-fired.
                </>
              ) : (
                <>
                  Cancelling stops each run at its current node. Everything already committed
                  stays committed, so a cancelled run can still be resumed later.
                </>
              )}
            </Text>
          </Dialog.Description>

          {isRetry ? (
            <dl className="border-subtle mt-3 grid gap-1.5 rounded-md border p-3">
              <Row label="Runs" value={String(estimate.runs)} />
              <Row label="Steps to replay" value={String(estimate.nodesToReplay)} />
              <Row
                label="Steps already committed"
                value={String(estimate.nodesSaved)}
                tone="success"
              />
              <Row label="Estimated cost" value={formatCost(estimate.costUsd)} />
              <Row
                label="Saved by checkpointing"
                value={formatCost(estimate.savedUsd)}
                tone="success"
              />
            </dl>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">Keep as is</Button>
            </Dialog.Close>
            {/* The count is in the button label, not just the prose above it —
                this is the last thing read before the click. */}
            <Button
              variant={isRetry ? "primary" : "danger"}
              size="sm"
              onClick={onConfirm}
            >
              {isRetry ? "Retry" : "Cancel"} {runs.length.toLocaleString("en-GB")}{" "}
              {runs.length === 1 ? "run" : "runs"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt><Text variant="caption" tone="muted">{label}</Text></dt>
      <dd>
        <Text
          variant="body-sm"
          tone={tone ? "inherit" : "primary"}
          tabular
          className={tone === "success" ? "text-status-success" : undefined}
        >
          {value}
        </Text>
      </dd>
    </div>
  );
}
