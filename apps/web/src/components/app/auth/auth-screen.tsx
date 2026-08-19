"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

import { AuthForm, type AuthMode } from "./auth-form";
import { mapAuthError, mapOAuthError, NETWORK_ERROR, type AuthErrorState } from "./auth-errors";
import type { SsoProvider } from "./auth-shell";
import { CredentialError, signInWithPassword, signUpWithPassword } from "~/lib/auth/session";
import { getAccessToken } from "~/lib/auth/token";

const OAUTH_ROUTES: Record<SsoProvider, string> = {
  github: "/api/auth/github",
  google: "/api/auth/google",
  microsoft: "/api/auth/microsoft",
};

/**
 * Container for sign-in and sign-up.
 *
 * The OAuth initiators are unchanged: they are server route handlers, and they
 * are server-side specifically because starting PKCE from the browser races the
 * `code_verifier` cookie write against the navigation to the provider — the bug
 * that made the first click fail and the second succeed.
 *
 * Credentials post to the same-origin `/api/auth/{signin,signup}` handlers,
 * which set the same httpOnly session cookie the OAuth callback sets. Both
 * routes therefore land on ONE session model, and the token layer cannot tell
 * which one was used.
 */
export function AuthScreen({ mode, next, error }: { mode: AuthMode; next?: string; error?: string }) {
  const router = useRouter();

  // Only ever honour same-site paths — never absolute URLs (open-redirect guard).
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  const [loading, setLoading] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<AuthErrorState | null>(null);

  const urlError = React.useMemo<AuthErrorState | null>(
    () => (error ? mapOAuthError(error) : null),
    [error],
  );

  // A fresh submission supersedes whatever the redirect complained about.
  const shownError = submitError ?? urlError;

  const onSso = React.useCallback((provider: SsoProvider) => {
    setLoading(true);
    const endpoint = OAUTH_ROUTES[provider];
    window.location.assign(`${endpoint}${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`);
  }, [safeNext]);

  const onSamlSso = React.useCallback((domain: string) => {
    setLoading(true);
    window.location.assign(`/api/auth/saml?domain=${encodeURIComponent(domain)}`);
  }, []);

  const onCredentials = React.useCallback(
    async (email: string, password: string, fullName?: string) => {
      setLoading(true);
      setSubmitError(null);
      try {
        if (mode === "signup") await signUpWithPassword(email, password, fullName);
        else await signInWithPassword(email, password);

        // Pull the token that goes with the cookie the handler just set, so the
        // destination page starts with a warm session instead of resolving one.
        await getAccessToken({ forceRefresh: true });

        router.replace((safeNext ?? "/control") as Route);
        router.refresh();
      } catch (cause) {
        setLoading(false);
        if (cause instanceof CredentialError) {
          setSubmitError(
            cause.status === 0 ? NETWORK_ERROR : mapAuthError(cause.message, cause.status, email),
          );
          return;
        }
        setSubmitError(mapAuthError(undefined, 500, email));
      }
    },
    [mode, router, safeNext],
  );

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
      error={shownError}
      onSso={onSso}
      onSamlSso={onSamlSso}
      onCredentials={(email, password, fullName) => void onCredentials(email, password, fullName)}
      onErrorAction={onErrorAction}
    />
  );
}
