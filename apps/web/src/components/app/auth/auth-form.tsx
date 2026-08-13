"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Checkbox } from "~/components/ui/choice";
import { AuthShell, AuthError, SsoButtons, Divider, type SsoProvider } from "./auth-shell";
import { PasswordStrength, passwordMeetsRules } from "./password-strength";
import { domainRequiresSso, type AuthErrorState } from "./auth-errors";

/* ══════════════════════════════════════════════════════════════════════════════
   SIGN IN / SIGN UP

   Presentational. Every side effect arrives as a prop, so the container keeps
   the existing API calls untouched and this file can be exercised in every
   state from Storybook without a server.

   VALIDATION FIRES ON BLUR, NEVER ON KEYSTROKE. Telling someone their email is
   invalid while they are three characters into typing it is noise that trains
   people to ignore the message that eventually matters.
══════════════════════════════════════════════════════════════════════════════ */

export type AuthMode = "signin" | "signup";

export interface AuthFormProps {
  mode: AuthMode;
  loading?: boolean;
  error?: AuthErrorState | null;
  /** Preserves the exact submit behaviour of the container. */
  onSubmit: (values: { email: string; password: string; fullName?: string; company?: string }) => void;
  onSso?: (provider: SsoProvider) => void;
  onSamlSso?: (domain: string) => void;
  onMagicLink?: (email: string) => void;
  onErrorAction?: (intent: NonNullable<AuthErrorState["action"]>["intent"], email: string) => void;
  /** Carried across from a "no account" error on the other screen. */
  initialEmail?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Consumer domains are fine to sign up with; we just prefer work addresses. */
const CONSUMER = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com"]);

export function AuthForm({
  mode, loading = false, error = null, onSubmit, onSso, onSamlSso, onMagicLink,
  onErrorAction, initialEmail = "",
}: AuthFormProps) {
  const isSignup = mode === "signup";

  const [email, setEmail] = React.useState(initialEmail);
  const [password, setPassword] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [magicSent, setMagicSent] = React.useState(false);

  // Touched-on-blur, so messages only appear once a field has been left.
  const [touched, setTouched] = React.useState<Record<string, boolean>>({});
  const touch = (name: string) => setTouched((t) => ({ ...t, [name]: true }));

  const ssoDomain = domainRequiresSso(email);
  const emailInvalid = touched.email && email.length > 0 && !EMAIL_RE.test(email);
  const emailMissing = touched.email && email.length === 0;
  const consumerDomain =
    isSignup && EMAIL_RE.test(email) && CONSUMER.has(email.split("@")[1]?.toLowerCase() ?? "");

  const passwordWeak = isSignup && touched.password && password.length > 0 && !passwordMeetsRules(password);
  const passwordMissing = touched.password && password.length === 0;

  const canSubmit =
    EMAIL_RE.test(email) &&
    password.length > 0 &&
    (!isSignup || passwordMeetsRules(password)) &&
    !loading &&
    !ssoDomain;

  const emailError = emailMissing
    ? "Enter your email address."
    : emailInvalid
      ? "That does not look like an email address. Check for a missing @ or domain."
      : undefined;

  const passwordError = passwordMissing
    ? "Enter your password."
    : passwordWeak
      ? "This password does not meet the requirements below."
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

      {error ? <AuthError error={error} onAction={(intent) => onErrorAction?.(intent, email)} /> : null}

      <SsoButtons onSelect={onSso} disabled={loading} verb={isSignup ? "Sign up" : "Continue"} />

      <Divider>or with email</Divider>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched({ email: true, password: true, fullName: true });
          if (!canSubmit) return;
          onSubmit({
            email,
            password,
            fullName: fullName.trim() || undefined,
            company: company.trim() || undefined,
          });
        }}
        className="grid gap-4"
      >
        {isSignup ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <Input
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={fullName}
                disabled={loading}
                onChange={(e) => setFullName(e.target.value)}
                onBlur={() => touch("fullName")}
              />
            </Field>
            <Field label="Company">
              <Input
                autoComplete="organization"
                placeholder="Acme"
                value={company}
                disabled={loading}
                onChange={(e) => setCompany(e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        <Field
          label={isSignup ? "Work email" : "Email"}
          required
          error={emailError}
          description={
            consumerDomain
              ? "A work address keeps your workspace with your team when you invite them."
              : undefined
          }
        >
          <Input
            type="email"
            inputMode="email"
            autoComplete={isSignup ? "email" : "username"}
            autoFocus
            placeholder="you@company.com"
            value={email}
            disabled={loading}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => touch("email")}
          />
        </Field>

        {/* Domain-routed SAML. The password field is replaced rather than
            disabled: there is no password for this account to get wrong. */}
        {ssoDomain ? (
          <div className="bg-accent-subtle border-accent-border rounded-md border p-3">
            <Text variant="body-sm" tone="primary" className="block">
              {ssoDomain} signs in with SAML SSO
            </Text>
            <Text variant="caption" tone="secondary" className="mt-1 block">
              You will be sent to your organisation&rsquo;s identity provider. No password needed here.
            </Text>
            <Button
              type="button"
              size="sm"
              variant="primary"
              className="mt-2.5"
              loading={loading}
              onClick={() => onSamlSso?.(ssoDomain)}
            >
              Continue to {ssoDomain}
            </Button>
          </div>
        ) : (
          <Field
            label="Password"
            required
            error={passwordError}
            characterCount={undefined}
          >
            <Input
              type={showPassword ? "text" : "password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder={isSignup ? "At least 12 characters" : "Your password"}
              value={password}
              disabled={loading}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => touch("password")}
              suffix={
                <button
                  type="button"
                  tabIndex={0}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((s) => !s)}
                  className="text-fg-muted hover:text-fg-primary rounded-xs outline-none transition-colors duration-fast focus-visible:focus-ring"
                >
                  <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
                    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"
                      stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
                    {showPassword ? <path d="M3 13 13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /> : null}
                  </svg>
                </button>
              }
            />
          </Field>
        )}

        {isSignup && !ssoDomain ? <PasswordStrength value={password} /> : null}

        {!isSignup && !ssoDomain ? (
          <div className="flex items-center justify-between gap-3">
            <Checkbox defaultChecked>
              <Text variant="caption" tone="secondary">Keep me signed in</Text>
            </Checkbox>
            <Link
              href={"/forgot-password" as never}
              className="font-ui text-caption text-fg-link rounded-sm underline-offset-2 outline-none hover:underline focus-visible:focus-ring"
            >
              Forgot password?
            </Link>
          </div>
        ) : null}

        {!ssoDomain ? (
          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={loading}
            loadingLabel={isSignup ? "Creating your workspace" : "Signing in"}
            disabled={!canSubmit}
          >
            {isSignup ? "Create workspace" : "Sign in"}
          </Button>
        ) : null}

        {isSignup ? (
          <Text variant="caption" tone="muted" className="block">
            By creating an account you agree to the{" "}
            <Link href={"/support" as never} className="text-fg-link underline-offset-2 hover:underline">terms</Link>{" "}
            and{" "}
            <Link href={"/settings/privacy" as never} className="text-fg-link underline-offset-2 hover:underline">privacy policy</Link>.
          </Text>
        ) : null}
      </form>

      {/* Magic link — for people who never set a password because they arrived
          through SSO, and for anyone who would rather not type one. */}
      {!isSignup && !ssoDomain ? (
        <div className="border-subtle mt-6 border-t pt-5">
          {magicSent ? (
            <div className="bg-status-success-subtle border-status-success-border rounded-md border p-3">
              <Text variant="body-sm" className="text-status-success block">Check {email}</Text>
              <Text variant="caption" tone="secondary" className="mt-1 block">
                The link signs you in once and expires in 15 minutes.
              </Text>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="md"
              fullWidth
              disabled={!EMAIL_RE.test(email) || loading}
              onClick={() => { onMagicLink?.(email); setMagicSent(true); }}
            >
              Email me a sign-in link instead
            </Button>
          )}
        </div>
      ) : null}
    </AuthShell>
  );
}
