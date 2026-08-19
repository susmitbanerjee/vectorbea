"use client";

import * as React from "react";

import { AuthForm, type AuthMode } from "./auth-form";
import { mapOAuthError, type AuthErrorState } from "./auth-errors";
import type { SsoProvider } from "./auth-shell";

const OAUTH_ROUTES: Record<SsoProvider, string> = {
  github: "/api/auth/github",
  google: "/api/auth/google",
  microsoft: "/api/auth/microsoft",
};

/**
 * Container for sign-in and sign-up.
 *
 * The OAuth initiators are server route handlers, and they are server-side
 * specifically because starting PKCE from the browser races the `code_verifier`
 * cookie write against the navigation to the provider — the bug that made the
 * first click fail and the second succeed.
 *
 * There is no credential path any more. Password sign-in was removed along with
 * the reset, verify and resend flows that existed only to support it, so this
 * container has exactly one job: send the browser to a provider and surface
 * whatever the callback complained about on the way back.
 */
export function AuthScreen({ mode, next, error }: { mode: AuthMode; next?: string; error?: string }) {
  // Only ever honour same-site paths — never absolute URLs (open-redirect guard).
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  const [loading, setLoading] = React.useState(false);

  const shownError = React.useMemo<AuthErrorState | null>(
    () => (error ? mapOAuthError(error) : null),
    [error],
  );

  const onSso = React.useCallback((provider: SsoProvider) => {
    setLoading(true);
    const endpoint = OAUTH_ROUTES[provider];
    window.location.assign(`${endpoint}${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`);
  }, [safeNext]);

  // `reset` and `resend` are gone with the password flows. `signup` and `sso`
  // are the only intents an OAuth callback can still produce.
  const onErrorAction = React.useCallback(
    (intent: NonNullable<AuthErrorState["action"]>["intent"]) => {
      if (intent === "signup") window.location.assign("/signup");
      else if (intent === "sso") window.location.assign("/support?topic=sso");
    },
    [],
  );

  return (
    <AuthForm
      mode={mode}
      loading={loading}
      error={shownError}
      onSso={onSso}
      onErrorAction={onErrorAction}
    />
  );
}
