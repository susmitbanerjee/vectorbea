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
 * THE NETWORK BEHAVIOUR IS UNCHANGED from the screen this replaces: the same
 * OAuth initiators, the same SAML route, and the same open-redirect guard on
 * `next`. What changed is that credentials are no longer an option — the
 * email/password POST to /api/auth/{signin,signup} is gone from the UI, though
 * the endpoints themselves are untouched.
 *
 * That leaves the provider round-trip as the only way to fail, so the `?error=`
 * code those routes redirect back with is now rendered rather than discarded.
 */
export function AuthScreen({ mode, next, error }: { mode: AuthMode; next?: string; error?: string }) {
  // Only ever honour same-site paths — never absolute URLs (open-redirect guard).
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  const [loading, setLoading] = React.useState(false);

  const urlError = React.useMemo<AuthErrorState | null>(
    () => (error ? mapOAuthError(error) : null),
    [error],
  );

  const onSso = React.useCallback((provider: SsoProvider) => {
    setLoading(true);
    const endpoint = OAUTH_ROUTES[provider];
    window.location.assign(`${endpoint}${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`);
  }, [safeNext]);

  const onSamlSso = React.useCallback((domain: string) => {
    setLoading(true);
    window.location.assign(`/api/auth/saml?domain=${encodeURIComponent(domain)}`);
  }, []);

  const onErrorAction = React.useCallback(
    (intent: NonNullable<AuthErrorState["action"]>["intent"]) => {
      if (intent === "signup") window.location.assign("/signup");
      else if (intent === "reset") window.location.assign("/forgot-password");
      else if (intent === "resend") window.location.assign("/verify-email");
      else if (intent === "sso") onSso("microsoft");
    },
    [onSso],
  );

  return (
    <AuthForm
      mode={mode}
      loading={loading}
      error={urlError}
      onSso={onSso}
      onSamlSso={onSamlSso}
      onErrorAction={onErrorAction}
    />
  );
}
