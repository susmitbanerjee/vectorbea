"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { AuthShell } from "./auth-shell";
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

/* ── Invitation link outcomes: accepted / expired / already used ──────────── */

export function VerifiedScreen({ next = "/onboarding" }: { next?: string }) {
  return (
    <AuthShell>
      <Centred
        icon={GateApprovedIcon}
        tone="success"
        title="You are in"
        actions={
          <Button asChild variant="primary" size="lg" fullWidth>
            <Link href={next as never}>Set up your workspace</Link>
          </Button>
        }
      >
        <Text variant="body-sm" tone="secondary" className="block">
          Your account is ready. Next you will name a workspace and connect a model provider —
          about four minutes.
        </Text>
      </Centred>
    </AuthShell>
  );
}

export function LinkExpiredScreen({
  email, onResend,
}: {
  email?: string;
  onResend?: () => void;
}) {
  const noun = "invitation";
  const window_ = "7 days";

  return (
    <AuthShell>
      <Centred
        icon={SlaTimerIcon}
        tone="waiting"
        title={`That ${noun} has expired`}
        actions={
          <Button asChild variant="secondary" size="lg" fullWidth onClick={onResend}>
            <Link href={"/support" as never}>Ask for a new invitation</Link>
          </Button>
        }
      >
        <Text variant="body-sm" tone="secondary" className="block">
          Links last {window_} so an old one in an inbox cannot be used later.
          {email ? <> It was sent to <span className="text-fg-primary">{email}</span>.</> : null}
          {" "}Ask whoever invited you to send another.
        </Text>
      </Centred>
    </AuthShell>
  );
}

export function LinkUsedScreen() {
  const done = "That invitation has already been accepted.";

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
        </Text>
      </Centred>
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
          <Button asChild variant="secondary" size="lg" fullWidth>
            <Link href={"/support" as never}>Contact support</Link>
          </Button>
        }
      >
        <Text variant="body-sm" tone="secondary" className="block">
          Repeated failed sign-in attempts locked the account for {minutes} minutes. This is
          automatic and nothing is wrong with the account itself.
        </Text>
        <Text variant="caption" tone="muted" className="mt-2 block">
          Sign-in happens at your identity provider, so there is no password here to change. If
          this was not you, secure the GitHub, Google or Microsoft account you sign in with.
        </Text>
      </Centred>
    </AuthShell>
  );
}
