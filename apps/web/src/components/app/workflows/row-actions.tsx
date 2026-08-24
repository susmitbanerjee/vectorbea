"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Field } from "~/components/ui/field";
import { overlaySurface, overlayMotion, menuItem } from "~/components/ui/select";
import type { Workflow } from "~/lib/workflows/model";

/* ══════════════════════════════════════════════════════════════════════════════
   ROW ACTIONS

   Run now · Open builder · View runs · Duplicate · Export JSON · Version history
   · Delete.

   THE DELETE CONFIRMATION NAMES WHAT BREAKS. Not "this cannot be undone" — the
   schedule that stops firing, the endpoint that starts 404ing, and the run
   history that goes with it. A workflow is the thing other systems are pointed
   at, so deleting one breaks callers who are not in the room. Naming them is the
   only way the person clicking can know whether they are about to.

   Typing the name to confirm is reserved for exactly this: it is the one action
   on the list with off-product blast radius.

   THE CONFIRMATION IS NOT RENDERED HERE. It used to be, once per row, inside
   the row's own DOM — under the row click handler that opens the workflow. So
   dismissing it delivered a click to the row and the detail page opened whether
   you pressed Keep it or Delete permanently. The view mounts ONE dialog outside
   the table and this menu only asks for it.
══════════════════════════════════════════════════════════════════════════════ */

export interface WorkflowActionHandlers {
  onRunNow: (workflow: Workflow) => void;
  onExport: (workflow: Workflow) => void;
  /** Opens the confirmation, which the VIEW owns — see [DeleteWorkflowDialog]. */
  onRequestDelete: (workflow: Workflow) => void;
  onSetStatus: (workflow: Workflow, status: Workflow["status"]) => void;
}

export function WorkflowRowActions({
  workflow, handlers, canBuild, align = "end",
}: {
  workflow: Workflow;
  handlers: WorkflowActionHandlers;
  /**
   * Developer and up. A viewer gets no trigger at all.
   *
   * Every item in this menu writes — run, pause, delete — so for a viewer the
   * menu is empty, and an empty menu is a worse answer than no menu. The API
   * refuses these regardless (`RbacGuard`); this is only about not offering them.
   */
  canBuild: boolean;
  align?: "start" | "end";
}) {
  const paused = workflow.status === "paused";
  const archived = workflow.status === "archived";

  if (!canBuild) return null;

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          data-row-stop
          aria-label={`Actions for ${workflow.name}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "text-fg-disabled hover:text-fg-primary grid size-6 place-items-center rounded-xs",
            "transition-colors duration-fast outline-none focus-visible:focus-ring",
            "data-[state=open]:bg-surface-active data-[state=open]:text-fg-primary",
          )}
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden="true">
            <circle cx="6" cy="2.4" r="1.1" fill="currentColor" />
            <circle cx="6" cy="6" r="1.1" fill="currentColor" />
            <circle cx="6" cy="9.6" r="1.1" fill="currentColor" />
          </svg>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align={align}
            sideOffset={6}
            onClick={(e) => e.stopPropagation()}
            className={cn(overlaySurface, overlayMotion, "z-popover w-56 p-1")}
          >
            <DropdownMenu.Item
              className={menuItem}
              disabled={archived}
              onSelect={() => handlers.onRunNow(workflow)}
            >
              Run now
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItem} asChild>
              <Link href={`/workflows/${workflow.id}/builder` as Route}>Open builder</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItem} asChild>
              <Link href={`/runs?q=workflow:${workflow.name}` as Route}>View runs</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItem} asChild>
              <Link href={`/workflows/${workflow.id}/versions` as Route}>Version history</Link>
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="bg-surface-active my-1 h-px" />

            {workflow.status !== "draft" ? (
              <DropdownMenu.Item
                className={menuItem}
                onSelect={() => handlers.onSetStatus(workflow, paused || archived ? "active" : "paused")}
              >
                {paused || archived ? "Activate" : "Pause"}
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item className={menuItem} onSelect={() => handlers.onExport(workflow)}>
              Export JSON
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="bg-surface-active my-1 h-px" />

            <DropdownMenu.Item
              className={cn(menuItem, "text-status-failed data-[highlighted]:text-status-failed")}
              onSelect={() => {
                // Do NOT preventDefault: that is what kept the menu open
                // underneath the modal, and left it open after the modal went.
                // Radix closes on select; the timeout lets that commit land
                // before the dialog claims the top layer.
                //
                // setTimeout, not requestAnimationFrame: rAF does not fire in a
                // tab that is not compositing, so the dialog would never open.
                setTimeout(() => handlers.onRequestDelete(workflow), 0);
              }}
            >
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

    </>
  );
}

/* ── Delete ───────────────────────────────────────────────────────────────── */

export function DeleteWorkflowDialog({
  workflow, onClose, onConfirm,
}: {
  workflow: Workflow | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = React.useState("");
  React.useEffect(() => { setTyped(""); }, [workflow?.id]);

  /*
   * The dialog animates out after `workflow` goes null, and re-rendering the
   * title as "Delete workflow" for those 150ms reads as a glitch. Holding the
   * last one keeps the closing frame identical to the open one.
   */
  const shown = React.useRef<Workflow | null>(null);
  if (workflow) shown.current = workflow;
  const subject = workflow ?? shown.current;

  const confirmed = workflow !== null && typed.trim() === workflow.name;

  return (
    <Dialog.Root open={workflow !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "motion-overlay z-modal fixed",
            "bg-surface-overlay border-subtle shadow-3 border",
            "inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-lg",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "sm:w-[min(34rem,calc(100vw-2rem))] sm:rounded-lg",
            "p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">
              Delete {subject?.name ?? "workflow"}
            </Text>
          </Dialog.Title>

          <Dialog.Description asChild>
            <Text variant="body-sm" tone="secondary" className="mt-1 block">
              Deleting removes the definition, every version of it, and the run history that
              proves what it did. Archiving keeps all of that and stops it firing.
            </Text>
          </Dialog.Description>

          <div className="mt-4">
            <Field
              label={`Type ${subject?.name ?? ""} to confirm`}
              description="Deliberately awkward. This is the only action here that breaks callers outside this workspace."
            >
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={subject?.name}
              />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">Keep it</Button>
            </Dialog.Close>
            <Button
              variant="danger"
              size="sm"
              disabled={!confirmed}
              onClick={onConfirm}
            >
              Delete permanently
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
