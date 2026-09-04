"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { cn } from "~/lib/cn";
import { overlaySurface, overlayMotion, menuItem } from "~/components/ui/select";

/* ══════════════════════════════════════════════════════════════════════════════
   REGISTRY ROW ACTIONS — agents and tools

   THERE WAS NO WAY TO DELETE ONE. The registries shipped with a bulk bar
   offering activate, deactivate and export, and no per-row menu at all — so an
   agent created by mistake could be paused and never removed, at any role,
   including owner. `api.agents.delete` and `api.tools.delete` existed the whole
   time with nothing calling them.

   ONE COMPONENT FOR BOTH REGISTRIES. Agents and tools differ by noun and by the
   detail route; every action and every guard is the same, and two copies drift
   the first time one of them gains a confirmation.

   THE MENU IS ROLE-AWARE. A viewer gets no trigger at all rather than a menu of
   disabled items: there is nothing in it they can do, and an empty menu is a
   worse answer than no menu. This is presentation — `RbacGuard` in the API is
   what actually refuses the call.
══════════════════════════════════════════════════════════════════════════════ */

export interface RegistryRecord {
  id: string;
  name: string;
  status?: string;
}

export interface RegistryActionHandlers<T extends RegistryRecord> {
  onSetStatus: (record: T, status: "active" | "paused") => void;
  onDuplicate?: (record: T) => void;
  onExport: (record: T) => void;
  /** Opens the confirmation, which the VIEW owns — see `RegistryDeleteDialog`. */
  onRequestDelete: (record: T) => void;
}

export function RegistryRowActions<T extends RegistryRecord>({
  record, noun, detailHref, handlers, canBuild, align = "end",
}: {
  record: T;
  /** "agent" | "tool" — used in labels and aria. */
  noun: string;
  detailHref: Route;
  handlers: RegistryActionHandlers<T>;
  /** Developer and up. A viewer gets no menu. */
  canBuild: boolean;
  align?: "start" | "end";
}) {
  if (!canBuild) return null;

  const paused = record.status === "paused";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        data-row-stop
        aria-label={`Actions for ${record.name}`}
        onClick={(event) => event.stopPropagation()}
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
          onClick={(event) => event.stopPropagation()}
          className={cn(overlaySurface, overlayMotion, "z-popover w-52 p-1")}
        >
          <DropdownMenu.Item className={menuItem} asChild>
            <Link href={detailHref}>Open {noun}</Link>
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={menuItem}
            onSelect={() => handlers.onSetStatus(record, paused ? "active" : "paused")}
          >
            {paused ? "Activate" : "Pause"}
          </DropdownMenu.Item>

          {handlers.onDuplicate ? (
            <DropdownMenu.Item className={menuItem} onSelect={() => handlers.onDuplicate!(record)}>
              Duplicate
            </DropdownMenu.Item>
          ) : null}

          <DropdownMenu.Item className={menuItem} onSelect={() => handlers.onExport(record)}>
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
                setTimeout(() => handlers.onRequestDelete(record), 0);
              }}
          >
            Delete
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
