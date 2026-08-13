"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Select } from "~/components/ui/select";
import { plural } from "~/mocks/control";
import type { Environment, Workflow } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   BULK ACTIONS — activate · pause · archive · export · move to environment.

   Every bulk action states the count in the button that performs it, and each
   one reports how many of the selection it actually applies to. "Pause 12" when
   9 of the 12 are already drafts is a lie the operator only discovers afterwards;
   "Pause 3" is the truth, and the disabled state explains the other 9.

   MOVING ENVIRONMENT IS BEHIND A DIALOG, the other four are not. Promoting a
   workflow to production is the one action here that starts something running
   against live data, and it needs a target picked before it can even be named.
══════════════════════════════════════════════════════════════════════════════ */

export interface WorkflowBulkBarProps {
  selected: Workflow[];
  onClear: () => void;
  onSetStatus: (workflows: Workflow[], status: Workflow["status"]) => void;
  onExport: (workflows: Workflow[]) => void;
  onMoveEnvironment: (workflows: Workflow[], environment: Environment) => void;
}

const ENVIRONMENTS = [
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "development", label: "Development" },
];

export function WorkflowBulkBar({
  selected, onClear, onSetStatus, onExport, onMoveEnvironment,
}: WorkflowBulkBarProps) {
  const [moving, setMoving] = React.useState(false);
  const [target, setTarget] = React.useState<Environment>("staging");

  const count = selected.length;
  // A draft has never been published, so there is nothing to activate or pause.
  const activatable = selected.filter((w) => w.status === "paused" || w.status === "archived");
  const pausable = selected.filter((w) => w.status === "active");
  const archivable = selected.filter((w) => w.status !== "archived");
  const moving_ = selected.filter((w) => w.environment !== target);

  if (count === 0) return null;

  return (
    <>
      <div
        role="region"
        aria-label={`${count} workflows selected`}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-sticky flex justify-center p-3 print:hidden"
      >
        <div
          data-motion="decorative"
          className={cn(
            "bg-surface-overlay border-default shadow-3 pointer-events-auto",
            "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2",
            "w-full max-w-[48rem]",
            "motion-safe:animate-[ink-drawer-in_180ms_var(--ease-standard)]",
          )}
        >
          <Text variant="body-sm" tone="primary" className="font-medium">
            <span className="tabular">{count.toLocaleString("en-GB")}</span> selected
          </Text>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <BulkButton
              label="Activate"
              applies={activatable.length}
              total={count}
              reason="Only paused and archived workflows can be activated."
              onClick={() => onSetStatus(activatable, "active")}
            />
            <BulkButton
              label="Pause"
              applies={pausable.length}
              total={count}
              reason="Only active workflows can be paused."
              onClick={() => onSetStatus(pausable, "paused")}
            />
            <BulkButton
              label="Archive"
              applies={archivable.length}
              total={count}
              reason="These are already archived."
              onClick={() => onSetStatus(archivable, "archived")}
            />
            <Button size="sm" variant="secondary" onClick={() => setMoving(true)}>
              Move…
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

      <Dialog.Root open={moving} onOpenChange={setMoving}>
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
              <Text variant="heading-sm" tone="max" as="h2">Move to another environment</Text>
            </Dialog.Title>
            <Dialog.Description asChild>
              <Text variant="body-sm" tone="secondary" className="mt-1 block">
                Moving re-points the workflow's connections at the target environment. Schedules
                keep their cron but start firing against the new data.
              </Text>
            </Dialog.Description>

            <div className="mt-3 grid gap-2">
              <Select
                options={ENVIRONMENTS}
                value={target}
                onValueChange={(v) => setTarget(v as Environment)}
                aria-label="Target environment"
              />
              <Text variant="caption" tone="muted">
                {moving_.length === 0
                  ? `All ${plural(count, "workflow")} already sit in ${target}.`
                  : `${plural(moving_.length, "workflow")} will move. ${count - moving_.length} already there.`}
              </Text>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button
                variant="primary"
                size="sm"
                disabled={moving_.length === 0}
                onClick={() => { onMoveEnvironment(moving_, target); setMoving(false); }}
              >
                Move {moving_.length} to {target}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/**
 * A bulk button that admits how much of the selection it covers.
 *
 * The count in the label is the count that will change, not the count selected.
 * They are usually different, and the gap is exactly the thing a bulk action
 * normally hides until it is too late to notice.
 */
function BulkButton({
  label, applies, total, reason, onClick,
}: {
  label: string;
  applies: number;
  total: number;
  reason: string;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={applies === 0}
      title={applies === 0 ? reason : applies < total ? `${applies} of ${total} selected` : undefined}
      onClick={onClick}
    >
      {label}{applies !== total ? ` ${applies}` : ""}
    </Button>
  );
}
