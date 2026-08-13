"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { AuthShell } from "./auth-shell";
import { PasswordStrength, passwordMeetsRules } from "./password-strength";
import type { IconComponent } from "~/components/icons/types";
import {
  ApprovalGateIcon, GateApprovedIcon, GateRejectedIcon, SlaTimerIcon, ByokKeyIcon,
} from "~/components/icons/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   The screens between sign-up and being signed in.

   Each link-based flow has three outcomes and all three are designed: it works,
   it expired, or it was already used. "Already used" matters more than it looks
   — it is what a user sees when they click the link twice, or when a mail
   scanner followed it first, and treating that as an error makes a working
   account look broken.
══════════════════════════════════════════════════════════════════════════════ */

function Centred({
  icon: Glyph, tone = "accent", title, children, actions,
}: {
  icon: IconComponent;
  tone?: "accent" | "success" | "failed" | "waiting";
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const toneClass = {
    accent: "bg-accent-subtle text-accent border-accent-border",
    success: "bg-status-success-subtle text-status-success border-status-success-border",
    failed: "bg-status-failed-subtle text-status-failed border-status-failed-border",
    waiting: "bg-status-waiting-subtle text-status-waiting border-status-waiting-border",
  }[tone];

  return (
    <>
      <span className={cn("mb-5 grid size-11 place-items-center rounded-lg border", toneClass)}>
        <Glyph size={22} aria-hidden="true" />
      </span>
      <Text variant="heading-lg" tone="max" as="h1" className="block">{title}</Text>
      <div className="mt-2">{children}</div>
      {actions ? <div className="mt-6 grid gap-2">{actions}</div> : null}
    </>
  );
}

/* ── Email verification, with resend timer and correction path ─────────────── */

const RESEND_SECONDS = 45;

export function VerifyEmailScreen({
  email, onResend, onChangeEmail,
}: {
  email: string;
  onResend?: () => void;
  onChangeEmail?: (next: string) => void;
}) {
  const [remaining, setRemaining] = React.useState(RESEND_SECONDS);
  const [sentCount, setSentCount] = React.useState(0);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(email);

  React.useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  return (
    <AuthShell>
      <Centred icon={SlaTimerIcon} tone="waiting" title="Confirm your email">
        <Text variant="body-sm" tone="secondary" className="block">
          We sent a link to <span className="text-fg-primary font-medium">{email}</span>. It expires in
          24 hours. Open it on any device — this tab will not update on its own.
        </Text>

        {sentCount > 0 ? (
          <Text variant="caption" tone="secondary" className="mt-2 block" aria-live="polite">
            Sent again. If it still does not arrive, check spam, or the address may be wrong.
          </Text>
        ) : null}

        <div className="mt-5 grid gap-2">
          <Button
            variant="secondary"
            fullWidth
            disabled={remaining > 0}
            onClick={() => { onResend?.(); setSentCount((c) => c + 1); setRemaining(RESEND_SECONDS); }}
          >
            {remaining > 0 ? `Resend in ${remaining}s` : "Resend the link"}
          </Button>

          {editing ? (
            <form
              className="border-subtle mt-2 grid gap-3 rounded-md border p-3"
              onSubmit={(e) => { e.preventDefault(); onChangeEmail?.(draft); setEditing(false); }}
            >
              <Field label="Correct email address" required>
                <Input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" size="sm" variant="primary">Send to this address</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" fullWidth onClick={() => setEditing(true)}>
              Wrong email? Change it
            </Button>
          )}
        </div>
      </Centred>
    </AuthShell>
  );
}

/* ── Link outcomes: verified / expired / already used ─────────────────────── */

export function VerifiedScreen({ next = "/onboarding" }: { next?: string }) {
  return (
    <AuthShell>
      <Centred
        icon={GateApprovedIcon}
        tone="success"
        title="Email confirmed"
        actions={
          <Button asChild variant="primary" size="lg" fullWidth>
            <Link href={next as never}>Set up your workspace</Link>
          </Button>
        }
      >
        <Text variant="body-sm" tone="secondary" className="block">
          Your address is verified. Next you will name a workspace and connect a model provider —
          about four minutes.
        </Text>
      </Centred>
    </AuthShell>
  );
}

export function LinkExpiredScreen({
  kind, email, onResend,
}: {
  kind: "verification" | "reset" | "invite";
  email?: string;
  onResend?: () => void;
}) {
  const noun = kind === "verification" ? "confirmation link" : kind === "reset" ? "reset link" : "invitation";
  const window_ = kind === "invite" ? "7 days" : "24 hours";

  return (
    <AuthShell>
      <Centred
        icon={SlaTimerIcon}
        tone="waiting"
        title={`That ${noun} has expired`}
        actions={
          kind === "invite" ? (
            <Button asChild variant="secondary" size="lg" fullWidth>
              <Link href={"/support" as never}>Ask for a new invitation</Link>
            </Button>
          ) : (
            <Button variant="primary" size="lg" fullWidth onClick={onResend}>
              Send a new {noun}
            </Button>
          )
        }
      >
        <Text variant="body-sm" tone="secondary" className="block">
          Links last {window_} so an old one in an inbox cannot be used later.
          {email ? <> We will send a new one to <span className="text-fg-primary">{email}</span>.</> : null}
          {kind === "invite" ? " Ask whoever invited you to send another." : null}
        </Text>
      </Centred>
    </AuthShell>
  );
}

export function LinkUsedScreen({ kind }: { kind: "verification" | "reset" | "invite" }) {
  const done =
    kind === "verification" ? "Your email is already confirmed."
      : kind === "reset" ? "That reset link has already been used."
        : "That invitation has already been accepted.";

  return (
    <AuthShell>
      <Centred
        icon={GateApprovedIcon}
        tone="success"
        title="Nothing left to do here"
        actions={
          <Button asChild variant="primary" size="lg" fullWidth>
            <Link href={"/signin" as never}>Go to sign in</Link>
          </Button>
        }
      >
        <Text variant="body-sm" tone="secondary" className="block">
          {done} This is not an error — links work once, so a second click lands here.
          {kind === "reset" ? " If you did not reset it, change your password now." : ""}
        </Text>
      </Centred>
    </AuthShell>
  );
}

/* ── Password reset ───────────────────────────────────────────────────────── */

export function ForgotPasswordScreen({
  initialEmail = "", onSubmit,
}: {
  initialEmail?: string;
  onSubmit?: (email: string) => void;
}) {
  const [email, setEmail] = React.useState(initialEmail);
  const [sent, setSent] = React.useState(false);

  if (sent) {
    return (
      <AuthShell>
        <Centred
          icon={SlaTimerIcon}
          tone="waiting"
          title="Check your email"
          actions={
            <Button asChild variant="ghost" size="lg" fullWidth>
              <Link href={"/signin" as never}>Back to sign in</Link>
            </Button>
          }
        >
          <Text variant="body-sm" tone="secondary" className="block">
            If an account exists for <span className="text-fg-primary">{email}</span>, a reset link is on
            its way. It expires in 24 hours.
          </Text>
          <Text variant="caption" tone="muted" className="mt-2 block">
            We do not confirm whether an address has an account — that would let anyone test which of
            your colleagues is registered.
          </Text>
        </Centred>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      footer={
        <Text variant="caption" tone="muted" className="block text-center">
          <Link href={"/signin" as never} className="text-fg-link underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </Text>
      }
    >
      <Text variant="heading-lg" tone="max" as="h1" className="block">Reset your password</Text>
      <Text variant="body-sm" tone="secondary" className="mt-1.5 mb-6 block">
        We will email you a link to choose a new one.
      </Text>

      <form
        className="grid gap-4"
        onSubmit={(e) => { e.preventDefault(); onSubmit?.(email); setSent(true); }}
      >
        <Field label="Email" required>
          <Input
            type="email"
            autoComplete="username"
            autoFocus
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" fullWidth disabled={!email.includes("@")}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}

export function ChoosePasswordScreen({ onSubmit }: { onSubmit?: (password: string) => void }) {
  const [password, setPassword] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const valid = passwordMeetsRules(password);

  return (
    <AuthShell>
      <Text variant="heading-lg" tone="max" as="h1" className="block">Choose a new password</Text>
      <Text variant="body-sm" tone="secondary" className="mt-1.5 mb-6 block">
        Signing in elsewhere will end those sessions.
      </Text>

      <form
        className="grid gap-4"
        onSubmit={(e) => { e.preventDefault(); setTouched(true); if (valid) onSubmit?.(password); }}
      >
        <Field
          label="New password"
          required
          error={touched && !valid && password.length > 0 ? "This does not meet the requirements below." : undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
        <PasswordStrength value={password} />
        <Button type="submit" variant="primary" size="lg" fullWidth disabled={!valid}>
          Set password and sign in
        </Button>
      </form>
    </AuthShell>
  );
}

/* ── Accept invite ────────────────────────────────────────────────────────── */

export function AcceptInviteScreen({
  workspace, inviter, role, email, onAccept,
}: {
  workspace: string;
  inviter: string;
  role: string;
  email: string;
  onAccept?: () => void;
}) {
  return (
    <AuthShell>
      <Centred
        icon={ApprovalGateIcon}
        title={`Join ${workspace}`}
        actions={
          <>
            <Button variant="primary" size="lg" fullWidth onClick={onAccept}>
              Accept and join
            </Button>
            <Button asChild variant="ghost" size="lg" fullWidth>
              <Link href={"/" as never}>Not now</Link>
            </Button>
          </>
        }
      >
        <Text variant="body-sm" tone="secondary" className="block">
          <span className="text-fg-primary">{inviter}</span> invited you to {workspace} as a{" "}
          <span className="text-fg-primary">{role}</span>.
        </Text>
        <div className="border-subtle mt-4 rounded-md border p-3">
          <Text variant="caption" tone="muted" className="block">Invitation sent to</Text>
          <Text variant="body-sm" tone="primary" className="block">{email}</Text>
          <Text variant="caption" tone="muted" className="mt-2 block">
            A {role} can view runs and approve gates. Admins can change this later.
          </Text>
        </div>
      </Centred>
    </AuthShell>
  );
}

/* ── Lockout ──────────────────────────────────────────────────────────────── */

export function LockedOutScreen({ minutes = 30 }: { minutes?: number }) {
  return (
    <AuthShell>
      <Centred
        icon={GateRejectedIcon}
        tone="failed"
        title="This account is locked"
        actions={
          <>
            <Button asChild variant="secondary" size="lg" fullWidth>
              <Link href={"/forgot-password" as never}>Reset the password instead</Link>
            </Button>
            <Button asChild variant="ghost" size="lg" fullWidth>
              <Link href={"/support" as never}>Contact support</Link>
            </Button>
          </>
        }
      >
        <Text variant="body-sm" tone="secondary" className="block">
          Five failed attempts locked the account for {minutes} minutes. This is automatic and
          nothing is wrong with the account itself.
        </Text>
        <Text variant="caption" tone="muted" className="mt-2 block">
          If this was not you, reset the password — someone has your address and is guessing.
        </Text>
      </Centred>
    </AuthShell>
  );
}
