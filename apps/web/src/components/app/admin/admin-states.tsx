"use client";

import * as React from "react";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";

/* ══════════════════════════════════════════════════════════════════════════════
   ADMIN SURFACE STATES

   The three governance screens share one failure mode that nothing else in the
   product has: the capability can be absent rather than broken. A backing table
   may simply not exist in a given deployment — the API answers 503
   `missing_database_migration`, and every one of these screens rendered that as
   a red box with a sentence addressed to somebody who is not looking at it
   ("Contact your admin to apply the latest schema updates" — shown to the
   admin).

   SO THE STATE SAYS WHICH THREE THINGS ARE TRUE:
     what is unavailable   — this capability, not "the page"
     why                   — a table is missing, you are not permitted, it broke
     who can act, and how  — the exact command, when there is one

   AND IT NAMES THE RIGHT DATABASE. There are two stores behind these screens:
   the application Postgres, migrated by Flyway out of the Kotlin API, and the
   legacy Supabase project that only the provider settings still read. Telling
   an operator to run `supabase db push` when the missing table is a Flyway one
   sends them to fix a database that was never the problem, so the remediation
   sentence is chosen by the caller that knows which store it queried.

   AN UNPROVISIONED CAPABILITY IS NOT AN ERROR, and it is drawn as `waiting`
   rather than `failed` for that reason. Nothing has gone wrong; a migration has
   not been applied. Painting it red teaches operators to ignore red.
══════════════════════════════════════════════════════════════════════════════ */

export function AdminState({
  tone, title, body, action, className,
}: {
  tone: "neutral" | "waiting" | "failed";
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "failed" ? "alert" : "status"}
      className={cn(
        "grid place-items-center rounded-lg border p-8 text-center",
        tone === "failed" ? "border-status-failed-border bg-status-failed-subtle"
          : tone === "waiting" ? "border-status-waiting-border bg-status-waiting-subtle"
            : "border-subtle bg-surface-raised",
        className,
      )}
    >
      <div className="max-w-[44rem]">
        <Text
          variant="heading-sm"
          tone="inherit"
          as="p"
          className={cn(
            "block",
            tone === "failed" ? "text-status-failed"
              : tone === "waiting" ? "text-status-waiting" : "text-fg-max",
          )}
        >
          {title}
        </Text>
        <Text variant="body-sm" tone="secondary" className="mt-1.5 block leading-snug">{body}</Text>
        {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

/** A compact peer, for a panel inside a page that is otherwise fine. */
export function AdminInlineState({
  tone, title, body, action,
}: {
  tone: "neutral" | "waiting" | "failed";
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "failed" ? "alert" : "status"}
      className={cn(
        "rounded-md border p-2.5",
        tone === "failed" ? "border-status-failed-border bg-status-failed-subtle"
          : tone === "waiting" ? "border-status-waiting-border bg-status-waiting-subtle"
            : "border-subtle bg-surface-sunken",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Text
            variant="body-sm"
            tone="inherit"
            as="p"
            className={cn(
              "block font-medium",
              tone === "failed" ? "text-status-failed"
                : tone === "waiting" ? "text-status-waiting" : "text-fg-primary",
            )}
          >
            {title}
          </Text>
          <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{body}</Text>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}

export interface AdminFailure {
  tone: "waiting" | "failed";
  title: string;
  body: string;
  retryable: boolean;
}

/** Which database the caller queried, so the remediation names the right one. */
export type AdminStore = "app" | "supabase";

const REMEDIATION: Record<AdminStore, string> = {
  app:
    "Apply the Flyway migrations in apps/api-kotlin/src/main/resources/db/migration — the API runs them on " +
    "boot when RUN_MIGRATIONS is true — and reload.",
  supabase:
    "Apply the migrations in apps/web/supabase/migrations (supabase db push, or paste them into the SQL " +
    "editor) and reload.",
};

/**
 * Turn an API failure into the three sentences above.
 *
 * `noun` names the capability, so the same helper produces "Usage meters are
 * not provisioned" and "The audit log is not provisioned" rather than a generic
 * line that leaves the reader guessing which part of the page died. `store`
 * names the database, because the two behind these screens are migrated by
 * different tools and the wrong instruction costs an afternoon.
 */
export function describeAdminFailure(
  error: unknown,
  noun: string,
  store: AdminStore = "app",
): AdminFailure {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (code === "missing_database_migration" || /migrations are missing/i.test(message)) {
    return {
      tone: "waiting",
      title: `${capitalise(noun)} are not provisioned in this environment`,
      body:
        `The tables behind ${noun} have not been created in this deployment's database, so there is nothing ` +
        `to read — this is a deployment step, not a fault. ${REMEDIATION[store]} Everything else on this ` +
        "page is unaffected.",
      retryable: true,
    };
  }

  if (code === "feature_locked") {
    return {
      tone: "waiting",
      title: `${capitalise(noun)} are not included in this plan`,
      body: message,
      retryable: false,
    };
  }

  if (/not a member|forbidden|403/i.test(message)) {
    return {
      tone: "waiting",
      title: "You do not have access to this",
      body: `Reading ${noun} needs membership of this workspace. Ask an owner or admin to add you.`,
      retryable: false,
    };
  }

  if (/unauthor|401|session/i.test(message)) {
    return {
      tone: "waiting",
      title: "Your session has expired",
      body: "Sign in again to continue. Nothing was lost.",
      retryable: false,
    };
  }

  return {
    tone: "failed",
    title: `${capitalise(noun)} could not be loaded`,
    body: `${message || "The request did not complete."} Nothing has changed — this is a read failure.`,
    retryable: true,
  };
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
