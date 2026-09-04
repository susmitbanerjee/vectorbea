"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";

/* ══════════════════════════════════════════════════════════════════════════════
   REGISTRY BULK ACTIONS — activate · deactivate · tag · export.

   Shared by both registries because the actions are identical; only the noun
   differs. Two copies would have drifted the first time one of them gained a
   confirmation.

   EXPORT IS THE ONLY ONE A VIEWER KEEPS. The rest write, and the API refuses
   them below developer, so offering them here would only produce 403s. Delete
   is new: the registries shipped with no way to remove an agent or a tool at
   any role, so one created by mistake could be paused and never removed.
══════════════════════════════════════════════════════════════════════════════ */

export function RegistryBulkBar({
  count, noun, onClear, onActivate, onDeactivate, onExport, onDelete, canBuild = true,
}: {
  count: number;
  noun: string;
  onClear: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onExport: () => void;
  /** Absent means the registry does not support bulk delete. */
  onDelete?: () => void;
  /** Developer and up. A viewer gets export only — the rest all write. */
  canBuild?: boolean;
}) {
  if (count === 0) return null;

  return (
    <div
      role="region"
      aria-label={`${count} ${noun}s selected`}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-sticky flex justify-center p-3 print:hidden"
    >
      <div
        data-motion="decorative"
        className={cn(
          "bg-surface-overlay border-default shadow-3 pointer-events-auto",
          "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2",
          "w-full max-w-[40rem]",
          "motion-safe:animate-[ink-drawer-in_180ms_var(--ease-standard)]",
        )}
      >
        <Text variant="body-sm" tone="primary" className="font-medium">
          <span className="tabular">{count}</span> {count === 1 ? noun : `${noun}s`} selected
        </Text>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {canBuild ? (
            <>
              <Button size="sm" variant="secondary" onClick={onActivate}>Activate</Button>
              <Button size="sm" variant="secondary" onClick={onDeactivate}>Deactivate</Button>
            </>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onExport}>Export</Button>
          {canBuild && onDelete ? (
            <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
          ) : null}
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
  );
}
