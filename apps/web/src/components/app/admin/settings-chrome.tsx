"use client";

import * as React from "react";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";

/* ══════════════════════════════════════════════════════════════════════════════
   SHARED SETTINGS CHROME

   Five settings screens with five hand-rolled panel headers is how the same
   surface ends up with three heading sizes and two ideas of where help text
   goes. One panel, one footer, one status line.

   THE FOOTER HOLDS THE SAVE. Every editable panel puts its action in the same
   place, so "where do I confirm this" is answered once for the whole area
   rather than per screen.
══════════════════════════════════════════════════════════════════════════════ */

export function Panel({
  title, help, action, footer, tone = "default", children, id,
}: {
  title: string;
  help?: React.ReactNode;
  /** Header-right control — a link out, a secondary action. */
  action?: React.ReactNode;
  /** The commit control and its status line. */
  footer?: React.ReactNode;
  tone?: "default" | "danger";
  children?: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "rounded-lg border",
        tone === "danger"
          ? "border-status-failed-border bg-surface-raised"
          : "border-subtle bg-surface-raised",
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3",
          tone === "danger" ? "border-status-failed-border" : "border-subtle",
        )}
      >
        <div className="min-w-0">
          <Text
            variant="label"
            tone={tone === "danger" ? "inherit" : "primary"}
            as="h2"
            className={cn("block", tone === "danger" && "text-status-failed")}
          >
            {title}
          </Text>
          {help ? (
            <Text variant="caption" tone="muted" className="mt-0.5 block max-w-[76ch] leading-snug">
              {help}
            </Text>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>

      {children ? <div className="grid gap-3 p-4">{children}</div> : null}

      {footer ? (
        <footer
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3",
            tone === "danger"
              ? "border-status-failed-border bg-status-failed-subtle"
              : "border-subtle bg-surface-sunken",
          )}
        >
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>
        <Text variant="caption" tone="muted">{label}</Text>
      </dt>
      <dd className="min-w-0">
        <Text variant="body-sm" tone="primary" className="block truncate">{children}</Text>
      </dd>
    </>
  );
}

export type SaveState = { tone: "ok" | "error"; text: string } | null;

/**
 * The line under a save button.
 *
 * It carries the outcome AND the resting explanation, so the space does not
 * jump when a message appears and vanish when it clears — and so a panel with
 * nothing to report still says what the button will do.
 */
export function StatusLine({ state, resting }: { state: SaveState; resting: React.ReactNode }) {
  return (
    <Text
      variant="caption"
      tone={state?.tone === "error" ? "inherit" : "muted"}
      role={state?.tone === "error" ? "alert" : "status"}
      className={cn(
        "block max-w-[76ch] leading-snug",
        state?.tone === "error" && "text-status-failed",
        state?.tone === "ok" && "text-status-success",
      )}
    >
      {state?.text ?? resting}
    </Text>
  );
}

/** A read-only value that is not a form control but sits in a form's rhythm. */
export function ReadOnlyRow({
  label, help, children,
}: {
  label: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <Text variant="label" tone="secondary" as="p" className="block">{label}</Text>
      <div className="min-w-0">{children}</div>
      {help ? (
        <Text variant="caption" tone="muted" className="block max-w-[76ch] leading-snug">{help}</Text>
      ) : null}
    </div>
  );
}

/**
 * The permission-denied state for a workspace settings section.
 *
 * Every settings route is enforced on the server by `assertWorkspaceMember` +
 * `requireWorkspaceRole`; this is what the person sees instead of a 403 they
 * have to interpret. It names the role they hold, the role the section needs,
 * and the one place they can still go — because "access denied" with no route
 * forward is how somebody ends up filing a support ticket to change their own
 * display name.
 */
export function SettingsDenied({ role, section }: { role: string | null; section: string }) {
  // Say what the role CAN do, accurately. "Which can build and run" under a
  // Viewer is a false statement about their own account, on the one screen
  // they went to in order to understand their access.
  const capability =
    role === "developer"
      ? "which can build and run workflows but not change how the workspace is configured"
      : role === "viewer"
        ? "which is read-only across the workspace"
        : "which does not cover workspace configuration";

  return (
    <div className="border-subtle bg-surface-raised grid place-items-center rounded-lg border p-8 text-center">
      <div className="max-w-[44rem]">
        <Text variant="heading-sm" tone="max" as="p" className="block">
          {section} is managed by owners and admins
        </Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block leading-snug">
          Your role in this workspace is{" "}
          <strong className="text-fg-primary capitalize">{role ?? "not set"}</strong>, {capability}. Ask an
          owner or admin if this needs to change. Your own name, avatar and password are on Profile.
        </Text>
      </div>
    </div>
  );
}
