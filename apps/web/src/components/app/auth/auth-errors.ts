/**
 * Auth failure states — design §12.
 *
 * "Errors state what happened and how to fix it. Never 'Something went wrong.'"
 *
 * The existing screen renders whatever string the API returns, which collapses
 * four genuinely different situations into one sentence. Those four need
 * different NEXT ACTIONS, and the action is the useful part:
 *
 *   wrong password  → reset it
 *   no account      → sign up instead, with the email carried across
 *   locked          → wait, and know how long
 *   sso-required    → go to the identity provider, not this form
 *
 * The API is unchanged. This maps its responses onto states the UI can act on,
 * and falls back to a plain, honest message when it sees something new.
 */

export type AuthErrorKind =
  | "wrong-password"
  | "no-account"
  | "locked"
  | "sso-required"
  | "rate-limited"
  | "unverified"
  | "network"
  | "unknown";

export interface AuthErrorState {
  kind: AuthErrorKind;
  title: string;
  body: string;
  /** The one thing to do next. Rendered as a button or link beside the message. */
  action?: { label: string; href?: string; intent?: "reset" | "signup" | "sso" | "resend" };
  /** Seconds until the user may retry. Drives a live countdown. */
  retryAfterSeconds?: number;
  /** SAML domain, when the failure is domain-routed. */
  domain?: string;
}

/**
 * Map an API response to a state.
 *
 * Matching is deliberately loose — substrings and status codes — because the
 * backend's error strings are not a versioned contract, and a mis-match must
 * degrade to the honest fallback rather than to a wrong instruction.
 */
export function mapAuthError(
  raw: string | undefined,
  status: number,
  email: string,
): AuthErrorState {
  const message = (raw ?? "").toLowerCase();
  const domain = email.includes("@") ? email.split("@")[1] : undefined;

  if (status === 429 || message.includes("too many") || message.includes("rate limit")) {
    return {
      kind: "rate-limited",
      title: "Too many attempts",
      body: "Sign-in is paused for this address to protect the account. Nothing is wrong with your credentials.",
      retryAfterSeconds: 60,
    };
  }

  if (message.includes("locked") || message.includes("disabled") || status === 423) {
    return {
      kind: "locked",
      title: "This account is locked",
      body: "Five failed attempts locked it for 30 minutes. A workspace admin can unlock it sooner.",
      action: { label: "Contact support", href: "/support" },
      retryAfterSeconds: 30 * 60,
    };
  }

  if (message.includes("sso") || message.includes("saml") || message.includes("identity provider")) {
    return {
      kind: "sso-required",
      title: `${domain ?? "This organisation"} requires SSO`,
      body: "Your workspace signs in through its identity provider, so there is no password to enter here.",
      action: { label: "Continue with SSO", intent: "sso" },
      domain,
    };
  }

  if (message.includes("verify") || message.includes("not confirmed") || message.includes("unverified")) {
    return {
      kind: "unverified",
      title: "Confirm your email first",
      body: "We sent a link when you signed up. It expires after 24 hours.",
      action: { label: "Resend the link", intent: "resend" },
    };
  }

  if (
    message.includes("no account") ||
    message.includes("not found") ||
    message.includes("no user") ||
    status === 404
  ) {
    return {
      kind: "no-account",
      title: "No account for that email",
      body: `We have no record of ${email || "that address"}. Check the spelling, or create an account.`,
      action: { label: "Create an account", intent: "signup" },
    };
  }

  if (
    message.includes("password") ||
    message.includes("invalid") ||
    message.includes("credential") ||
    status === 401
  ) {
    return {
      kind: "wrong-password",
      title: "That password is not right",
      body: "The email exists, so the address is fine. Try again, or reset the password.",
      action: { label: "Reset password", intent: "reset" },
    };
  }

  return {
    kind: "unknown",
    // Still no "Something went wrong": say what we know and what to do.
    title: "Sign-in did not complete",
    body: raw?.trim()
      ? raw
      : "The server rejected the request without saying why. Try again; if it keeps happening, send us the time it occurred.",
    action: { label: "Contact support", href: "/support" },
  };
}

export const NETWORK_ERROR: AuthErrorState = {
  kind: "network",
  title: "Could not reach Vectorbea",
  body: "The request never left your device or never got a reply. Check your connection and try again.",
};

/**
 * Domains that route to SAML.
 *
 * Stubbed until the enterprise SSO directory exists; the UI path is what
 * matters now, so an email at one of these shows the SSO route instead of a
 * password field.
 */
const SSO_DOMAINS = new Set(["acme-corp.com", "northwind.example", "kestrel.de"]);

export function domainRequiresSso(email: string): string | null {
  const at = email.indexOf("@");
  if (at === -1) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return SSO_DOMAINS.has(domain) ? domain : null;
}
