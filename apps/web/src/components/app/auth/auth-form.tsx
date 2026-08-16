"use client";

import * as React from "react";
import Link from "next/link";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { AuthShell, AuthError, SsoButtons, Divider, type SsoProvider } from "./auth-shell";
import type { AuthErrorState } from "./auth-errors";

/* ══════════════════════════════════════════════════════════════════════════════
   SIGN IN / SIGN UP

   Identity providers only. There is no password on this screen because there is
   no password to type: every account is federated through GitHub, Google,
   Microsoft, or the workspace's own SAML identity provider.

   The SAML route asks for a DOMAIN rather than an email address. It is the one
   piece of text this screen collects, and it exists to route the browser to the
   right identity provider — not to identify the person, which the IdP does.

   Presentational. Every side effect arrives as a prop, so the container keeps
   the existing redirects untouched and this file can be exercised in every state
   from Storybook without a server.
══════════════════════════════════════════════════════════════════════════════ */

export type AuthMode = "signin" | "signup";

export interface AuthFormProps {
  mode: AuthMode;
  loading?: boolean;
  error?: AuthErrorState | null;
  onSso?: (provider: SsoProvider) => void;
  onSamlSso?: (domain: string) => void;
  onErrorAction?: (intent: NonNullable<AuthErrorState["action"]>["intent"]) => void;
}

/** Labels, not validation: a domain that does not exist fails at the IdP, not here. */
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Accepts a bare domain or a work address, and returns the domain either way. */
function toDomain(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const at = trimmed.indexOf("@");
  const domain = at === -1 ? trimmed : trimmed.slice(at + 1);
  return DOMAIN_RE.test(domain) ? domain : null;
}

export function AuthForm({
  mode, loading = false, error = null, onSso, onSamlSso, onErrorAction,
}: AuthFormProps) {
  const isSignup = mode === "signup";

  const [samlOpen, setSamlOpen] = React.useState(false);
  const [domainInput, setDomainInput] = React.useState("");
  // Touched-on-blur, so the message only appears once the field has been left.
  const [touched, setTouched] = React.useState(false);
  const domainRef = React.useRef<HTMLInputElement>(null);

  // Focus follows the disclosure. The trigger unmounts when the form opens, so
  // without this the focus falls back to <body> and a keyboard user has to tab
  // in from the top of the page to reach the field they just asked for.
  React.useEffect(() => {
    if (samlOpen) domainRef.current?.focus();
  }, [samlOpen]);

  const domain = toDomain(domainInput);
  const domainError =
    !touched
      ? undefined
      : domainInput.trim().length === 0
        ? "Enter the domain your organisation signs in with."
        : !domain
          ? "That does not look like a domain. Use the part after the @, such as acme-corp.com."
          : undefined;

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
      <Text variant="body-sm" tone="secondary" className="mt-1.5 mb-6 block">
        {isSignup
          ? "Free while in beta. Bring your own model keys."
          : "Welcome back."}
      </Text>

      {error ? <AuthError error={error} onAction={(intent) => onErrorAction?.(intent)} /> : null}

      <SsoButtons onSelect={onSso} disabled={loading} verb={isSignup ? "Sign up" : "Continue"} />

      <Divider>or</Divider>

      {/* SAML. Collapsed by default: most people use one of the three above, and
          an always-open domain field reads as a sign-in form that it is not. */}
      {samlOpen ? (
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (!domain || loading) return;
            onSamlSso?.(domain);
          }}
        >
          <Field
            label="Work domain"
            required
            error={domainError}
            description={domainError ? undefined : "You will be sent to your organisation's identity provider."}
          >
            <Input
              ref={domainRef}
              type="text"
              inputMode="url"
              autoComplete="organization"
              spellCheck={false}
              placeholder="acme-corp.com"
              value={domainInput}
              disabled={loading}
              onChange={(e) => setDomainInput(e.target.value)}
              onBlur={() => setTouched(true)}
            />
          </Field>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={loading}
              loadingLabel="Contacting your identity provider"
              disabled={!domain}
            >
              Continue with SSO
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={loading}
              onClick={() => { setSamlOpen(false); setTouched(false); }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="lg"
          fullWidth
          disabled={loading}
          onClick={() => setSamlOpen(true)}
        >
          {isSignup ? "Sign up" : "Continue"} with SAML SSO
        </Button>
      )}

      {isSignup ? (
        <Text variant="caption" tone="muted" className="mt-6 block">
          By creating an account you agree to the{" "}
          <Link href={"/support" as never} className="text-fg-link underline-offset-2 hover:underline">terms</Link>{" "}
          and{" "}
          <Link href={"/settings/privacy" as never} className="text-fg-link underline-offset-2 hover:underline">privacy policy</Link>.
        </Text>
      ) : null}
    </AuthShell>
  );
}
