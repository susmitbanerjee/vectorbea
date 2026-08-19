"use client";

import * as React from "react";
import Link from "next/link";
import { Text } from "~/components/ui/text";
import { AuthShell, AuthError, SsoButtons } from "./auth-shell";
import type { AuthErrorState } from "./auth-errors";

/* ══════════════════════════════════════════════════════════════════════════════
   SIGN IN / SIGN UP

   Federated identity only. There is no password on this product: every account
   arrives through GitHub, Google, Microsoft, or an enterprise SAML provider.

   WHY NO PASSWORD FIELD. A password field is not free even when it is optional.
   It is the widest part of the attack surface (credential stuffing, reuse,
   phishing, reset-link interception), it drags a whole support tail behind it —
   reset, verify, resend, strength rules — and every one of those is a screen
   that has to be designed, tested and kept correct. Removing it removes all of
   that at once, and OAuth addresses arrive already verified, so the
   verification step it existed to enable is also gone.

   THE LAYOUT IS SHORTER ON PURPOSE. Four buttons and no fields is a small card.
   It is centred rather than stretched, and the right column is narrower than it
   was, so the left panel carries the page. Padding a short card out to the
   height of the form it replaced would leave a tall empty box and make the
   remaining choices look like leftovers.

   Presentational. Every side effect arrives as a prop, so the container keeps
   the existing redirects untouched and this file can be exercised in every state
   from Storybook without a server.
══════════════════════════════════════════════════════════════════════════════ */

export type AuthMode = "signin" | "signup";

export interface AuthFormProps {
  mode: AuthMode;
  loading?: boolean;
  error?: AuthErrorState | null;
  onSso?: (provider: import("./auth-shell").SsoProvider) => void;
  onErrorAction?: (intent: NonNullable<AuthErrorState["action"]>["intent"]) => void;
}

/**
 * Where "Single sign-on" goes.
 *
 * SAML is NOT wired on this project — there is no `/api/auth/saml` handler and
 * nothing calls Supabase's `signInWithSSO`, so the old button collected a domain
 * and navigated to a 404. Rather than hide the option entirely, it routes to
 * support: enterprise SSO is a demand signal worth capturing, and a contact link
 * that works is honest in a way a sign-in button that 404s is not.
 */
const SSO_CONTACT_HREF = "/support?topic=sso";

export function AuthForm({
  mode, loading = false, error = null, onSso, onErrorAction,
}: AuthFormProps) {
  const isSignup = mode === "signup";

  return (
    <AuthShell
      footer={
        <Text variant="caption" tone="muted" className="block text-center">
          {isSignup ? (
            <>Already have an account? <Link href={"/signin" as never} className="text-fg-link underline-offset-2 hover:underline">Sign in</Link></>
          ) : (
            <>New to Vectorbea? <Link href={"/signup" as never} className="text-fg-link underline-offset-2 hover:underline">Create an account</Link></>
          )}
        </Text>
      }
    >
      <Text variant="heading-lg" tone="max" as="h1" className="block">
        {isSignup ? "Create your workspace" : "Sign in"}
      </Text>
      <Text variant="body-sm" tone="secondary" className="mt-1.5 mb-5 block">
        {isSignup
          ? "Free while in beta. Bring your own model keys."
          : "Continue with the account you signed up with."}
      </Text>

      {error ? <AuthError error={error} onAction={(intent) => onErrorAction?.(intent)} /> : null}

      <SsoButtons onSelect={onSso} disabled={loading} verb={isSignup ? "Sign up" : "Continue"} />

      {/* Enterprise SSO. A quiet third tier rather than a fourth equal button:
          it is the right answer for a small minority of accounts, and giving it
          the same weight as GitHub would misrepresent how people get in. */}
      <div className="border-subtle mt-5 border-t pt-4">
        <Text variant="caption" tone="muted" className="block">
          Your organisation uses SAML single sign-on?{" "}
          <Link
            href={SSO_CONTACT_HREF as never}
            className="text-fg-link underline-offset-2 hover:underline"
          >
            Talk to us about SSO
          </Link>
        </Text>
      </div>

      <Text variant="caption" tone="muted" className="mt-5 block">
        {isSignup ? (
          <>
            By creating an account you agree to the{" "}
            <Link href={"/support" as never} className="text-fg-link underline-offset-2 hover:underline">terms</Link>{" "}
            and{" "}
            <Link href={"/settings/privacy" as never} className="text-fg-link underline-offset-2 hover:underline">privacy policy</Link>.
          </>
        ) : (
          <>We never ask for a password. If a page asks you for one, it is not us.</>
        )}
      </Text>
    </AuthShell>
  );
}
