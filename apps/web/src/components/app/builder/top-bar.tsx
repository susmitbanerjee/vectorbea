"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import type { ValiditySummary } from "./validation";

/* ══════════════════════════════════════════════════════════════════════════════
   TOP BAR

   DEBUG RUN IS NOT A VARIANT OF RUN. It is a different action with different
   consequences — it executes against real connections with step-through and full
   payload capture, which means real side effects AND a log that retains request
   bodies. Rendering it as a secondary button beside Run makes the two look like
   a preference. It gets its own slot after a separator, its own outline
   treatment and its own glyph, so nobody reaches for it by muscle memory.

   THE VALIDITY CHIP IS A LIVE FACT, not a result. It updates as you type, so it
   is a state of the graph rather than the outcome of a check you remembered to
   run.
══════════════════════════════════════════════════════════════════════════════ */

export type SaveState = "saved" | "saving" | "dirty" | "error";

export interface TopBarProps {
  /** Only identity and name are drawn here — not the whole row. */
  workflow: { id: string; name: string };
  versionNumber: number;
  isDraft: boolean;
  summary: ValiditySummary;
  saveState: SaveState;
  lastSavedAt: number | null;
  presentation: boolean;
  onTogglePresentation: () => void;
  onToggleFullscreen: () => void;
  fullscreen: boolean;
  onSave: () => void;
  onTest: () => void;
  onSimulate: () => void;
  onRun: () => void;
  onDebugRun: () => void;
}

export function TopBar({
  workflow, versionNumber, isDraft, summary, saveState, lastSavedAt,
  presentation, onTogglePresentation, onToggleFullscreen, fullscreen,
  onSave, onTest, onSimulate, onRun, onDebugRun,
}: TopBarProps) {
  if (presentation) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-sticky flex justify-center p-3">
        <div className="border-subtle bg-surface-overlay/90 pointer-events-auto flex items-center gap-3 rounded-full border px-3 py-1.5 backdrop-blur-sm">
          <Text variant="body-sm" tone="primary">{workflow.name}</Text>
          <Text variant="caption" tone="muted" tabular>v{versionNumber}{isDraft ? " draft" : ""}</Text>
          <Button size="xs" variant="ghost" onClick={onTogglePresentation}>
            Exit presentation <Kbd keys="Esc" className="ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <header className="border-subtle bg-surface-base flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
      {/* Breadcrumb. */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
        <Link
          href={"/workflows" as Route}
          className="font-ui text-caption text-fg-muted hover:text-fg-secondary rounded-xs outline-none transition-colors duration-fast focus-visible:focus-ring"
        >
          Workflows
        </Link>
        <span className="text-fg-disabled" aria-hidden="true">/</span>
        <Link
          href={`/workflows/${workflow.id}` as Route}
          className="font-ui text-body-sm text-fg-primary hover:text-accent min-w-0 truncate rounded-xs outline-none transition-colors duration-fast focus-visible:focus-ring"
        >
          {workflow.name}
        </Link>

        <span
          className={cn(
            "font-code ml-1 shrink-0 rounded-xs border px-1 py-px text-[10px] tabular",
            isDraft
              ? "border-status-waiting-border bg-status-waiting-subtle text-status-waiting"
              : "border-subtle text-fg-muted",
          )}
          title={isDraft ? "An unpublished draft" : "The published version"}
        >
          v{versionNumber}{isDraft ? " draft" : ""}
        </span>
      </nav>

      {/* Autosave. */}
      <SaveIndicator state={saveState} lastSavedAt={lastSavedAt} />

      {/* Validity, live. */}
      <span
        className={cn(
          "font-ui text-caption inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5",
          summary.errors > 0
            ? "border-status-failed-border bg-status-failed-subtle text-status-failed"
            : summary.warnings > 0
              ? "border-status-waiting-border bg-status-waiting-subtle text-status-waiting"
              : "border-status-success-border bg-status-success-subtle text-status-success",
        )}
        title={
          summary.errors > 0
            ? `${summary.errors} errors block publishing`
            : summary.warnings > 0
              ? `${summary.warnings} warnings — they do not block publishing`
              : "Valid"
        }
      >
        {summary.errors > 0
          ? `${summary.errors} ${summary.errors === 1 ? "error" : "errors"}`
          : summary.warnings > 0
            ? `${summary.warnings} ${summary.warnings === 1 ? "warning" : "warnings"}`
            : "Valid"}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <IconButton label={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={onToggleFullscreen}>
          {fullscreen ? (
            <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.6 1.5v3.1H1.5M7.4 1.5v3.1h3.1M4.6 10.5V7.4H1.5M7.4 10.5V7.4h3.1" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 4.4V1.5h2.9M7.6 1.5h2.9v2.9M10.5 7.6v2.9H7.6M4.4 10.5H1.5V7.6" />
            </svg>
          )}
        </IconButton>

        <IconButton label="Presentation mode — hides every panel" onClick={onTogglePresentation}>
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
            <rect x="1.2" y="2" width="9.6" height="6.4" rx="1" />
            <path d="M6 8.4v1.8M4.2 10.4h3.6" />
          </svg>
        </IconButton>

        <Button asChild size="sm" variant="ghost">
          <Link href={`/workflows/${workflow.id}/versions` as Route}>History</Link>
        </Button>

        <Button size="sm" variant="secondary" onClick={onSave} disabled={saveState === "saved"}>
          Save
        </Button>
        <Button size="sm" variant="secondary" onClick={onTest}>Test</Button>
        <Button size="sm" variant="secondary" onClick={onSimulate}>Simulate</Button>

        <Button
          size="sm"
          variant="primary"
          onClick={onRun}
          disabled={summary.errors > 0}
          title={summary.errors > 0 ? "Fix the errors first" : "Run against live connections"}
        >
          Run
        </Button>

        {/* Deliberately separated and differently shaped. Debug Run has the same
            real-world consequences as Run and additionally captures full
            payloads — it must not be one pixel of muscle memory away. */}
        <span className="bg-surface-active mx-0.5 h-5 w-px" aria-hidden="true" />
        <Button
          size="sm"
          variant="secondary"
          onClick={onDebugRun}
          disabled={summary.errors > 0}
          title="Steps through node by node against live connections, capturing full payloads"
          className="border-status-waiting-border text-status-waiting hover:border-status-waiting border-dashed"
        >
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="6" cy="6.4" r="2.8" />
            <path d="M6 3.6V2.2M3.2 5.2 2 4.6M8.8 5.2 10 4.6M3.2 7.8 2 8.4M8.8 7.8 10 8.4" />
          </svg>
          Debug run
        </Button>
      </div>
    </header>
  );
}

function SaveIndicator({ state, lastSavedAt }: { state: SaveState; lastSavedAt: number | null }) {
  const label =
    state === "saving" ? "Saving…"
      : state === "dirty" ? "Unsaved changes"
        : state === "error" ? "Autosave failed"
          : lastSavedAt
            ? `Saved ${new Date(lastSavedAt).toISOString().slice(11, 16)}`
            : "Saved";

  return (
    <span
      className={cn(
        "font-ui text-caption inline-flex items-center gap-1.5",
        state === "error" ? "text-status-failed" : state === "dirty" ? "text-status-waiting" : "text-fg-muted",
      )}
      // The only thing on this bar that changes without the user acting, so it
      // is announced politely rather than silently.
      aria-live="polite"
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          state === "saving" ? "bg-status-live" : state === "dirty" ? "bg-status-waiting" : state === "error" ? "bg-status-failed" : "bg-status-success",
        )}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "text-fg-muted hover:text-fg-primary hover:bg-surface-hover grid size-7 place-items-center rounded-sm",
        "transition-colors duration-fast outline-none focus-visible:focus-ring",
      )}
    >
      {children}
    </button>
  );
}
