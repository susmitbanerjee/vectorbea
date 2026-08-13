"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Wordmark } from "~/components/app/shell/wordmark";
import { AmbientRun } from "./ambient-run";
import type { AuthErrorState } from "./auth-errors";

/**
 * <AuthShell> — the split layout shared by every auth screen.
 *
 * The left panel is dark and the right is the page theme, so the form sits on
 * the calmer surface. Below lg the panel is dropped entirely rather than stacked
 * above the form: on a phone, a visitor who opened a sign-in link wants the
 * fields, not a demonstration they have to scroll past.
 */
export function AuthShell({
  children, footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="bg-surface-app text-fg-primary font-ui min-h-dvh">
      <div className="grid min-h-dvh lg:grid-cols-[1.05fr_minmax(26rem,32rem)]">
        <section className="dark bg-surface-app border-subtle relative hidden overflow-hidden border-r p-10 xl:p-14 lg:flex lg:flex-col">
          <Link href="/" className="w-fit rounded-sm outline-none focus-visible:focus-ring">
            <Wordmark />
          </Link>
          <AmbientRun className="my-auto pt-12" />
          <Text variant="caption" tone="muted" className="block max-w-[46ch]">
            Bring your own model keys. Runs execute on our workers or inside your VPC. We do not train
            on your data.
          </Text>
        </section>

        <section className="bg-surface-base flex flex-col">
          <div className="flex items-center justify-between gap-4 p-5 lg:hidden">
            <Link href="/" className="rounded-sm outline-none focus-visible:focus-ring">
              <Wordmark />
            </Link>
          </div>

          <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center px-5 py-10 sm:px-8">
            {children}
          </div>

          {footer ? (
            <div className="border-subtle mx-auto w-full max-w-[26rem] border-t px-5 py-4 sm:px-8">
              {footer}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/* ── Error banner ─────────────────────────────────────────────────────────── */

export function AuthError({
  error, onAction,
}: {
  error: AuthErrorState;
  onAction?: (intent: NonNullable<AuthErrorState["action"]>["intent"]) => void;
}) {
  const [remaining, setRemaining] = React.useState(error.retryAfterSeconds ?? 0);

  React.useEffect(() => {
    setRemaining(error.retryAfterSeconds ?? 0);
    if (!error.retryAfterSeconds) return;
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(timer);
  }, [error]);

  const countdown =
    remaining > 60
      ? `${Math.ceil(remaining / 60)} minutes`
      : remaining > 0
        ? `${remaining} seconds`
        : null;

  return (
    <div
      role="alert"
      className="bg-status-failed-subtle border-status-failed-border mb-5 rounded-md border p-3"
    >
      <Text variant="body-sm" className="text-status-failed block font-medium">{error.title}</Text>
      <Text variant="caption" tone="secondary" className="mt-1 block">{error.body}</Text>

      {countdown ? (
        <Text variant="caption" tone="muted" className="tabular mt-1.5 block" aria-live="polite">
          You can try again in {countdown}.
        </Text>
      ) : null}

      {error.action ? (
        <div className="mt-2.5">
          {error.action.href ? (
            <Button asChild size="sm" variant="secondary">
              <Link href={error.action.href as never}>{error.action.label}</Link>
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => onAction?.(error.action!.intent)}>
              {error.action.label}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ── SSO ──────────────────────────────────────────────────────────────────── */

const PROVIDER_MARKS = {
  github: (
    <path
      d="M10 1.6a8.4 8.4 0 0 0-2.7 16.4c.4.1.6-.2.6-.4v-1.5c-2.3.5-2.8-1.1-2.8-1.1-.4-1-.9-1.2-.9-1.2-.8-.5.1-.5.1-.5.8.1 1.3.9 1.3.9.8 1.3 2 .9 2.5.7.1-.6.3-1 .5-1.2-1.9-.2-3.9-.9-3.9-4.1 0-.9.3-1.7.9-2.2-.1-.3-.4-1.2.1-2.4 0 0 .7-.2 2.3.9a8 8 0 0 1 4.2 0c1.6-1.1 2.3-.9 2.3-.9.5 1.2.2 2.1.1 2.4.6.5.9 1.3.9 2.2 0 3.2-2 3.9-3.9 4.1.3.3.6.8.6 1.6v2.4c0 .2.2.5.6.4A8.4 8.4 0 0 0 10 1.6Z"
      fill="currentColor"
    />
  ),
  google: (
    <>
      <path d="M18 10.2c0-.6-.05-1.2-.16-1.7H10v3.3h4.5a3.9 3.9 0 0 1-1.7 2.5v2.1h2.7c1.6-1.5 2.5-3.6 2.5-6.2Z" fill="currentColor" opacity=".9" />
      <path d="M10 18.3c2.3 0 4.2-.75 5.6-2l-2.7-2.1c-.75.5-1.7.8-2.9.8-2.2 0-4.1-1.5-4.8-3.5H2.4v2.2A8.5 8.5 0 0 0 10 18.3Z" fill="currentColor" opacity=".7" />
      <path d="M5.2 11.5a5.1 5.1 0 0 1 0-3.2V6.1H2.4a8.5 8.5 0 0 0 0 7.6l2.8-2.2Z" fill="currentColor" opacity=".55" />
      <path d="M10 4.9c1.25 0 2.4.43 3.3 1.28l2.4-2.4A8.5 8.5 0 0 0 2.4 6.1l2.8 2.2C5.9 6.4 7.8 4.9 10 4.9Z" fill="currentColor" />
    </>
  ),
  microsoft: (
    <g fill="currentColor">
      <rect x="2.4" y="2.4" width="6.6" height="6.6" />
      <rect x="11" y="2.4" width="6.6" height="6.6" opacity=".8" />
      <rect x="2.4" y="11" width="6.6" height="6.6" opacity=".8" />
      <rect x="11" y="11" width="6.6" height="6.6" opacity=".6" />
    </g>
  ),
} as const;

export type SsoProvider = keyof typeof PROVIDER_MARKS;

const PROVIDER_LABEL: Record<SsoProvider, string> = {
  github: "GitHub",
  google: "Google",
  microsoft: "Microsoft",
};

export function SsoButtons({
  onSelect, disabled, verb = "Continue",
}: {
  onSelect?: (provider: SsoProvider) => void;
  disabled?: boolean;
  verb?: string;
}) {
  return (
    <div className="grid gap-2">
      {(Object.keys(PROVIDER_MARKS) as SsoProvider[]).map((provider) => (
        <Button
          key={provider}
          variant="secondary"
          size="lg"
          fullWidth
          disabled={disabled}
          onClick={() => onSelect?.(provider)}
          iconLeft={
            <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true" focusable="false">
              {PROVIDER_MARKS[provider]}
            </svg>
          }
        >
          {verb} with {PROVIDER_LABEL[provider]}
        </Button>
      ))}
    </div>
  );
}

export function Divider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="bg-surface-active h-px flex-1" />
      <Text variant="caption" tone="muted">{children}</Text>
      <span className="bg-surface-active h-px flex-1" />
    </div>
  );
}
