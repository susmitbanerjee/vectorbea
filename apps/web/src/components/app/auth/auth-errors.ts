/**
 * Auth failure states — design §12.
 *
 * "Errors state what happened and how to fix it. Never 'Something went wrong.'"
 *
 * Sign-in is federated, so the provider round-trip is the ONLY way this screen
 * can fail. Every state below is something `/api/auth/callback` or one of the
 * three initiators can actually produce; the credential mapper that used to
 * live here went with the password field, because none of its cases —
 * wrong credential, unverified email, reset — can occur any more.
 */

export type AuthErrorKind =
  | "no-account"
  | "locked"
  | "sso-required"
  | "rate-limited"
  | "network"
  | "unknown";

export interface AuthErrorState {
  kind: AuthErrorKind;
  title: string;
  body: string;
  /** The one thing to do next. Rendered as a button or link beside the message. */
  action?: { label: string; href?: string; intent?: "signup" | "sso" };
  /** Seconds until the user may retry. Drives a live countdown. */
  retryAfterSeconds?: number;
  /** SAML domain, when the failure is domain-routed. */
  domain?: string;
}

/**
 * Map the `?error=` code an OAuth route redirects back with.
 *
 * The provider round-trip is the only way this screen can fail now, and the
 * codes are ours — `/api/auth/callback` and the three initiators emit them — so
 * unlike `mapAuthError` this is an exact lookup with an honest fallback.
 */
export function mapOAuthError(code: string): AuthErrorState {
  if (code === "callback_failed") {
    return {
      kind: "unknown",
      title: "Your provider signed you in, but we could not finish",
      body: "The hand-back to Vectorbea failed or expired. Starting again almost always works — the sign-in window is short.",
      action: { label: "Contact support", href: "/support" },
    };
  }

  if (code === "oauth") {
    return {
      kind: "unknown",
      title: "Could not reach that provider",
      body: "We could not start the sign-in handshake. Try another provider, or try this one again in a moment.",
    };
  }

  if (code === "access_denied") {
    return {
      kind: "unknown",
      title: "You cancelled at your provider",
      body: "Nothing was shared with us. Choose a provider below to try again.",
    };
  }

  if (code === "provider_error") {
    return {
      kind: "unknown",
      title: "Your provider refused the request",
      body: "The provider rejected the sign-in before it reached us, which usually means its app configuration changed. Try another provider while we look into it.",
      action: { label: "Contact support", href: "/support" },
    };
  }

  if (code === "code_expired") {
    return {
      kind: "unknown",
      title: "That sign-in link expired",
      body: "The hand-back from your provider is only valid for a few minutes. Choose a provider below to start again.",
    };
  }

  if (code === "code_used") {
    return {
      kind: "unknown",
      title: "That sign-in link was already used",
      body: "Each hand-back works once, so reloading the callback page will not work. Choose a provider below to start again.",
    };
  }

  return {
    kind: "unknown",
    // Still no "Something went wrong": say what we know and what to do.
    title: "Sign-in did not complete",
    body: `Your provider returned "${code}" and we do not have a specific fix for it. Try again; if it keeps happening, send us the time it occurred.`,
    action: { label: "Contact support", href: "/support" },
  };
}

export const NETWORK_ERROR: AuthErrorState = {
  kind: "network",
  title: "Could not reach Vectorbea",
  body: "The request never left your device or never got a reply. Check your connection and try again.",
};
