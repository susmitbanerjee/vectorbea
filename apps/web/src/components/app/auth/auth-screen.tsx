"use client";

import * as React from "react";
import { setAccessToken } from "@/lib/api/client";
import { AuthForm, type AuthMode } from "./auth-form";
import { mapAuthError, NETWORK_ERROR, type AuthErrorState } from "./auth-errors";
import type { SsoProvider } from "./auth-shell";

const OAUTH_ROUTES: Record<SsoProvider, string> = {
  github: "/api/auth/github",
  google: "/api/auth/google",
  microsoft: "/api/auth/microsoft",
};

/**
 * Container for sign-in and sign-up.
 *
 * THE NETWORK BEHAVIOUR IS UNCHANGED from the screen this replaces: the same two
 * endpoints, the same body shape, the same `setAccessToken`, the same
 * open-redirect guard on `next`, and the same post-signup routing to
 * /verify-email. Only the presentation and the error mapping are new.
 *
 * Auth is the one flow where a re-skin must not become a rewrite — a subtle
 * change here locks every user out, and nothing about the visual work required
 * touching the request.
 */
export function AuthScreen({ mode, next }: { mode: AuthMode; next?: string }) {
  // Only ever honour same-site paths — never absolute URLs (open-redirect guard).
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<AuthErrorState | null>(null);

  const isSignup = mode === "signup";

  const submit = React.useCallback(
    async ({ email, password, fullName }: { email: string; password: string; fullName?: string }) => {
      setError(null);
      setLoading(true);

      try {
        const endpoint = isSignup ? "/api/auth/signup" : "/api/auth/signin";
        const body = isSignup
          ? { email, password, fullName: fullName?.trim() || undefined }
          : { email, password };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const data = (await res.json()) as {
          error?: string;
          accessToken?: string;
          user?: { id: string; email: string };
          requiresVerification?: boolean;
        };

        if (!res.ok) {
          setError(mapAuthError(data.error, res.status, email));
          return;
        }

        if (data.accessToken) setAccessToken(data.accessToken);

        if (isSignup && data.requiresVerification) {
          window.location.assign("/verify-email");
          return;
        }

        window.location.assign(safeNext ?? "/dashboard");
      } catch {
        setError(NETWORK_ERROR);
      } finally {
        setLoading(false);
      }
    },
    [isSignup, safeNext],
  );

  const onSso = React.useCallback((provider: SsoProvider) => {
    const endpoint = OAUTH_ROUTES[provider];
    window.location.assign(`${endpoint}${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`);
  }, [safeNext]);

  const onErrorAction = React.useCallback(
    (intent: NonNullable<AuthErrorState["action"]>["intent"], email: string) => {
      if (intent === "signup") window.location.assign(`/signup?email=${encodeURIComponent(email)}`);
      else if (intent === "reset") window.location.assign(`/forgot-password?email=${encodeURIComponent(email)}`);
      else if (intent === "resend") window.location.assign("/verify-email");
      else if (intent === "sso") onSso("microsoft");
    },
    [onSso],
  );

  return (
    <AuthForm
      mode={mode}
      loading={loading}
      error={error}
      onSubmit={submit}
      onSso={onSso}
      onSamlSso={(domain) => window.location.assign(`/api/auth/saml?domain=${encodeURIComponent(domain)}`)}
      onMagicLink={(email) => {
        void fetch("/api/auth/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }).catch(() => { /* the UI already says "check your email" */ });
      }}
      onErrorAction={onErrorAction}
    />
  );
}
