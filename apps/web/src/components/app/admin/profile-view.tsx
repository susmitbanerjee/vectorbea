"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { TimezonePicker } from "~/components/ui/timezone-picker";
import { PlanRing, planTier } from "~/components/ui/plan-badge";
import { useEntitlements } from "~/lib/entitlements/use-entitlements";
import { browserTimeZone, setPreferredTimeZone } from "~/lib/time/time-zone";
import { cn } from "~/lib/cn";
import { AdminInlineState, describeAdminFailure } from "./admin-states";
import { SettingsNav } from "./settings-nav";
import { Panel, ReadOnlyRow, StatusLine, type SaveState } from "./settings-chrome";

/* ══════════════════════════════════════════════════════════════════════════════
   PROFILE

   This page was static. It rendered the sentence "Your name and email come from
   your OAuth provider — we don't store them separately", which is not true:
   `app_users` holds `full_name`, `avatar_url` and `password_hash`, all written
   at sign-up. There was simply nothing to change them with.

   THE PERSON, NOT THE TENANT. No workspace scope here — a profile is the same
   in every workspace somebody belongs to, and scoping it would give one person
   as many names as they have memberships.

   EMAIL IS SHOWN AND NOT EDITABLE. It is the login identifier and the address
   every invitation was sent to; changing it is an account-recovery flow with a
   verification step, not a text field. Offering it as one is exactly the kind
   of half-built control this rebuild exists to remove — so the field says why
   instead.
══════════════════════════════════════════════════════════════════════════════ */

interface Profile {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  status: string;
  emailVerified: boolean;
  betaStatus: string;
  isPlatformAdmin: boolean;
  hasPassword: boolean;
  createdAt: string;
  timeZone: string | null;
}

const NAME_MAX = 120;
const PASSWORD_MIN = 12;

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(json.error || fallback);
    (error as Error & { code?: string }).code = json.code;
    throw error;
  }
  return json;
}

export function ProfileView() {
  const profile = useQuery<Profile, Error>({
    queryKey: ["settings", "profile"],
    queryFn: async () =>
      readJson<Profile>(await fetch("/api/settings/profile", { cache: "no-store" }), "Your profile could not be loaded"),
    retry: false,
  });
  React.useEffect(() => {
    if (profile.data) setPreferredTimeZone(profile.data.timeZone ?? null);
  }, [profile.data]);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Profile"
        description="Your account, across every workspace."
        metadata={
          profile.data ? (
            <>
              <Text variant="caption" tone="muted">Signed in as</Text>
              <Text variant="caption" tone="secondary">{profile.data.email ?? "Unknown"}</Text>
            </>
          ) : undefined
        }
      />

      <SettingsNav />

      {profile.error ? (() => {
        const failure = describeAdminFailure(profile.error, "your profile");
        return (
          <AdminInlineState
            tone={failure.tone}
            title={failure.title}
            body={failure.body}
            action={failure.retryable
              ? <Button size="xs" variant="secondary" onClick={() => void profile.refetch()}>Retry</Button>
              : undefined}
          />
        );
      })() : null}

      <div className="grid gap-4">
        <AccountPanel profile={profile.data} loading={profile.isPending} />
        {profile.data ? <SecurityPanel profile={profile.data} /> : null}
      </div>
    </PageContainer>
  );
}

/* ── Account ──────────────────────────────────────────────────────────────── */

function AccountPanel({ profile, loading }: { profile: Profile | undefined; loading: boolean }) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = React.useState("");
  const [timeZone, setTimeZone] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<SaveState>(null);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (profile && !loaded) {
      setFullName(profile.fullName ?? "");
      setTimeZone(profile.timeZone ?? null);
      setLoaded(true);
    }
  }, [profile, loaded]);

  const save = useMutation({
    mutationFn: async () =>
      readJson<Profile>(
        await fetch("/api/settings/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: fullName.trim() || null, timeZone }),
        }),
        "Your profile could not be saved",
      ),
    onSuccess: (next) => {
      setStatus({ tone: "ok", text: "Profile saved." });
      setPreferredTimeZone(next.timeZone ?? null);
      queryClient.setQueryData(["settings", "profile"], next);
      void queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (error: Error) => setStatus({ tone: "error", text: error.message }),
  });

  const nameError = fullName.length > NAME_MAX ? `Keep it to ${NAME_MAX} characters or fewer.` : undefined;
  const dirty =
    Boolean(profile) &&
    (fullName !== (profile!.fullName ?? "") || timeZone !== (profile!.timeZone ?? null));

  return (
    <Panel
      title="Account"
      footer={
        <>
          <StatusLine state={status} resting={dirty ? "Unsaved changes." : ""} />
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty || Boolean(nameError) || loading}
            loading={save.isPending}
            loadingLabel="Saving"
            onClick={() => { setStatus(null); save.mutate(); }}
          >
            Save profile
          </Button>
        </>
      }
    >
      {loading ? <FormSkeleton rows={2} /> : null}

      {profile ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar url={profile.avatarUrl} name={fullName || profile.email || "?"} />
          <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-2">
            <Field label="Display name" error={nameError}>
              <Input
                value={fullName}
                maxLength={NAME_MAX}
                placeholder="Not set"
                onChange={(event) => { setFullName(event.target.value); setStatus(null); }}
              />
            </Field>
            <Field
              label="Time zone"
              description={timeZone ? undefined : `Using your browser's zone, ${browserTimeZone()}.`}
            >
              <TimezonePicker
                value={timeZone}
                onValueChange={(value) => { setTimeZone(value); setStatus(null); }}
              />
            </Field>
            <ReadOnlyRow label="Email">
              <span className="flex flex-wrap items-center gap-2">
                <Text variant="body-sm" tone="primary">{profile.email ?? "Not recorded"}</Text>
                {profile.emailVerified ? <Badge tone="success">Verified</Badge> : <Badge tone="waiting">Unverified</Badge>}
              </span>
            </ReadOnlyRow>
            <ReadOnlyRow label="Member since">
              <span className="flex flex-wrap items-center gap-2">
                <Text variant="body-sm" tone="primary">{new Date(profile.createdAt).toLocaleDateString()}</Text>
                {profile.isPlatformAdmin ? <Badge tone="accent">Platform admin</Badge> : null}
              </span>
            </ReadOnlyRow>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

/* ── Security ─────────────────────────────────────────────────────────────── */

function SecurityPanel({ profile }: { profile: Profile }) {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [status, setStatus] = React.useState<SaveState>(null);

  const change = useMutation({
    mutationFn: async () =>
      readJson<{ ok: boolean }>(
        await fetch("/api/settings/profile/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: current, newPassword: next }),
        }),
        "Your password could not be changed",
      ),
    onSuccess: () => {
      setCurrent(""); setNext(""); setConfirm("");
      setStatus({ tone: "ok", text: "Password changed. Existing sessions stay signed in." });
    },
    onError: (error: Error) => setStatus({ tone: "error", text: error.message }),
  });

  if (!profile.hasPassword) {
    return (
      <Panel title="Password">
        <Text variant="body-sm" tone="secondary">You sign in through a single sign-on provider, so there is no password to change here.</Text>
      </Panel>
    );
  }

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN;
  const mismatch = confirm.length > 0 && confirm !== next;
  const same = next.length > 0 && next === current;
  const ready = current.length > 0 && next.length >= PASSWORD_MIN && confirm === next && !same;

  return (
    <Panel
      title="Password"
      help="Changing it needs your current password."
      footer={
        <>
          <StatusLine
            state={status}
            resting={`At least ${PASSWORD_MIN} characters.`}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!ready}
            loading={change.isPending}
            loadingLabel="Changing"
            onClick={() => { setStatus(null); change.mutate(); }}
          >
            Change password
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => { setCurrent(event.target.value); setStatus(null); }}
          />
        </Field>
        <Field
          label="New password"
          error={tooShort ? `At least ${PASSWORD_MIN} characters.` : same ? "Choose something different from your current password." : undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => { setNext(event.target.value); setStatus(null); }}
          />
        </Field>
        <Field label="Confirm new password" error={mismatch ? "These do not match." : undefined}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => { setConfirm(event.target.value); setStatus(null); }}
          />
        </Field>
      </div>
    </Panel>
  );
}

/* ── Atoms ────────────────────────────────────────────────────────────────── */

/**
 * The picture, inside the ring of the plan the current workspace is on.
 *
 * The ring is the WORKSPACE's, even here on a page about the person — that is
 * the only plan the API will enforce for them while they are in it, and it is
 * the same ring the sidebar draws two hundred pixels to the left. Reading it as
 * "my plan" is the misreading this whole treatment has to survive, so the two
 * places it appears are the two places the account already lives, and neither
 * of them is a members list.
 */
function Avatar({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => { setBroken(false); }, [url]);

  const { planCode } = useEntitlements();
  const tier = planTier(planCode);

  // `lg` offset: at 64px a two-pixel gap closes up and the ring reads as a
  // border on the photo rather than as something around it.
  return (
    <PlanRing tier={tier} offset="lg">
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote avatar, not a build-time asset
        <img
          src={url}
          alt=""
          onError={() => setBroken(true)}
          className="border-subtle size-16 shrink-0 rounded-full border object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="bg-accent-subtle text-accent border-accent-border grid size-16 shrink-0 place-items-center rounded-full border"
        >
          <Text variant="heading-sm" tone="inherit">{name.slice(0, 1).toUpperCase()}</Text>
        </span>
      )}
    </PlanRing>
  );
}

function Badge({ tone, children }: { tone: "success" | "waiting" | "accent"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "font-ui text-caption rounded-full border px-1.5 py-0.5 capitalize",
        tone === "success" && "border-status-success-border bg-status-success-subtle text-status-success",
        tone === "waiting" && "border-status-waiting-border bg-status-waiting-subtle text-status-waiting",
        tone === "accent" && "border-accent-border bg-accent-subtle text-accent",
      )}
    >
      {children}
    </span>
  );
}

function FormSkeleton({ rows }: { rows: number }) {
  return (
    <div className="grid gap-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid gap-1.5">
          <div className="bg-surface-active h-3 w-24 animate-pulse rounded-xs" />
          <div className="bg-surface-active h-8 w-full animate-pulse rounded-md" />
        </div>
      ))}
    </div>
  );
}
