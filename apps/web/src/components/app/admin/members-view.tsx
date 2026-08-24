"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, PaperPlaneTilt } from "@phosphor-icons/react/dist/ssr";

import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { DestructiveConfirmDialog } from "~/components/ui/destructive-confirm-dialog";
import { RelativeTime } from "~/components/app/workflows/atoms";
import { cn } from "~/lib/cn";
import { useScope } from "~/lib/workspace/workspace-provider";
import { AdminInlineState, describeAdminFailure } from "./admin-states";
import { SettingsNav } from "./settings-nav";
import { Panel, StatusLine, type SaveState } from "./settings-chrome";

/* ══════════════════════════════════════════════════════════════════════════════
   MEMBERS

   This screen ended with the line "Member changes and invitations are hidden
   because the current backend route is read-only". That was honest and it was
   the whole problem: the only route from "this person left the company" to
   "this person cannot reach the workspace" was a manual UPDATE in production.

   The routes exist now, and so do the two rules that make membership safe:

     THE LAST OWNER CANNOT BE DEMOTED OR REMOVED, enforced in the UPDATE's WHERE
     clause rather than by a disabled button, because a client-side check loses
     the race between two simultaneous demotions.

     PROMOTING TO OWNER NEEDS OWNER. An admin who can mint owners can promote
     themselves, which makes the role decorative.

   Both are shown as well as enforced — the select is disabled with the reason
   attached rather than letting somebody discover the rule from a 409.
══════════════════════════════════════════════════════════════════════════════ */

type Role = "owner" | "admin" | "developer" | "viewer";

interface Member {
  userId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: Role;
  status: "active" | "invited" | "disabled";
  joinedAt: string;
  isWorkspaceOwner: boolean;
}

interface MemberList {
  members: Member[];
  yourRole: Role;
  yourUserId: string | null;
}

interface EmailDelivery {
  sent: boolean;
  reason: string | null;
  configured: boolean;
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  inviterName: string;
  expiresAt: string;
  createdAt: string;
  state: "pending" | "accepted" | "revoked" | "expired";
}

const ROLE_OPTIONS: { value: Role; label: string; description: string }[] = [
  { value: "owner", label: "Owner", description: "Full control, including deleting the workspace" },
  { value: "admin", label: "Admin", description: "Manage members, settings and connections" },
  { value: "developer", label: "Developer", description: "Build and run workflows" },
  { value: "viewer", label: "Viewer", description: "Read-only across the workspace" },
];

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner", admin: "Admin", developer: "Developer", viewer: "Viewer",
};

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const json = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(json.error || fallback);
    (error as Error & { code?: string }).code = json.code;
    throw error;
  }
  return json;
}

export function MembersView() {
  const { workspaceId } = useScope();
  const queryClient = useQueryClient();
  const [failure, setFailure] = React.useState<string | null>(null);

  const members = useQuery<MemberList, Error>({
    queryKey: ["members", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () =>
      readJson<MemberList>(
        await fetch(`/api/workspaces/${encodeURIComponent(workspaceId!)}/members`, { cache: "no-store" }),
        "The member list could not be loaded",
      ),
  });

  const invitations = useQuery<{ invitations: Invitation[] }, Error>({
    queryKey: ["invitations", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () =>
      readJson<{ invitations: Invitation[] }>(
        await fetch(`/api/workspaces/${encodeURIComponent(workspaceId!)}/invitations`, { cache: "no-store" }),
        "Invitations could not be loaded",
      ),
  });

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["members", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["invitations", workspaceId] });
  }, [queryClient, workspaceId]);

  const yourRole = members.data?.yourRole ?? "viewer";
  const canManage = yourRole === "owner" || yourRole === "admin";
  const rows = members.data?.members ?? [];
  const activeOwners = rows.filter((member) => member.role === "owner" && member.status === "active").length;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Members"
        description="Who can reach this workspace, at what role, and who is still waiting on an invitation."
        metadata={
          members.data ? (
            <>
              <Text variant="caption" tone="muted">Your role</Text>
              <Text variant="caption" tone="secondary">{ROLE_LABEL[yourRole]}</Text>
            </>
          ) : undefined
        }
      />

      <SettingsNav />

      {failure ? (
        <div className="mb-3">
          <AdminInlineState
            tone="failed"
            title="That change was not applied"
            body={failure}
            action={<Button size="xs" variant="secondary" onClick={() => setFailure(null)}>Dismiss</Button>}
          />
        </div>
      ) : null}

      <div className="grid gap-4">
        <Panel
          title="Members"
          help={
            canManage
              ? "Changing a role or removing somebody takes effect on their next request, and is recorded in the audit log."
              : "Managing members needs the admin or owner role. You can see who has access but not change it."
          }
        >
          {members.isPending ? <RowSkeleton rows={3} /> : null}

          {members.error ? (() => {
            const described = describeAdminFailure(members.error, "members");
            return (
              <AdminInlineState
                tone={described.tone}
                title={described.title}
                body={described.body}
                action={described.retryable
                  ? <Button size="xs" variant="secondary" onClick={() => void members.refetch()}>Retry</Button>
                  : undefined}
              />
            );
          })() : null}

          {rows.length > 0 ? (
            <ul className="border-subtle divide-subtle divide-y rounded-md border">
              {rows.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  workspaceId={workspaceId!}
                  yourRole={yourRole}
                  isYou={member.userId === members.data?.yourUserId}
                  soleOwner={member.role === "owner" && activeOwners <= 1}
                  onChanged={refresh}
                  onFailure={setFailure}
                />
              ))}
            </ul>
          ) : null}
        </Panel>

        <InvitePanel
          workspaceId={workspaceId}
          canManage={canManage}
          invitations={invitations}
          onChanged={refresh}
        />
      </div>
    </PageContainer>
  );
}

/* ── One member ───────────────────────────────────────────────────────────── */

function MemberRow({
  member, workspaceId, yourRole, isYou, soleOwner, onChanged, onFailure,
}: {
  member: Member;
  workspaceId: string;
  yourRole: Role;
  isYou: boolean;
  soleOwner: boolean;
  onChanged: () => void;
  onFailure: (message: string) => void;
}) {
  const router = useRouter();
  const [confirmRemove, setConfirmRemove] = React.useState(false);

  const canManage = yourRole === "owner" || yourRole === "admin";
  // Promoting to owner needs owner, so an admin gets a select without that
  // option rather than a 403 after choosing it.
  const options = yourRole === "owner" ? ROLE_OPTIONS : ROLE_OPTIONS.filter((role) => role.value !== "owner");
  const roleLocked = !canManage || soleOwner || (yourRole !== "owner" && member.role === "owner");

  const setRole = useMutation({
    mutationFn: async (role: Role) =>
      readJson<Member>(
        await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.userId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role }),
          },
        ),
        "That role could not be changed",
      ),
    onSuccess: onChanged,
    onError: (error: Error) => onFailure(error.message),
  });

  const remove = useMutation({
    mutationFn: async () =>
      readJson<{ left: boolean; remainingWorkspaces?: { id: string }[] }>(
        await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.userId)}`,
          { method: "DELETE" },
        ),
        "That member could not be removed",
      ),
    onSuccess: (result) => {
      setConfirmRemove(false);
      if (result.left) {
        // You are no longer in this workspace — everything cached below it is
        // now somebody else's data.
        router.replace("/control" as Route);
        router.refresh();
        return;
      }
      onChanged();
    },
    onError: (error: Error) => { setConfirmRemove(false); onFailure(error.message); },
  });

  const name = member.fullName ?? member.email ?? "Unknown member";
  // Anybody may remove themselves; removing somebody else needs admin.
  const canRemove = isYou || canManage;
  const removeBlocked = soleOwner;

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <Avatar url={member.avatarUrl} name={name} />

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <Text variant="body-sm" tone="primary" className="truncate font-medium">{name}</Text>
          {isYou ? (
            <span className="border-subtle bg-surface-sunken text-fg-muted font-ui text-caption rounded-full border px-1.5">
              You
            </span>
          ) : null}
          {member.status === "invited" ? (
            <span className="border-status-waiting-border bg-status-waiting-subtle text-status-waiting font-ui text-caption rounded-full border px-1.5">
              Invited
            </span>
          ) : null}
        </span>
        <Text variant="caption" tone="muted" className="block truncate">
          {member.email ?? "No email recorded"} · joined <RelativeTime iso={member.joinedAt} />
        </Text>
      </span>

      <div className="w-40 shrink-0">
        <Field label={`Role for ${name}`} labelHidden>
          <Select
            value={member.role}
            disabled={roleLocked || setRole.isPending}
            onValueChange={(value) => setRole.mutate(value as Role)}
            options={options}
          />
        </Field>
      </div>

      <Button
        size="sm"
        variant={isYou ? "secondary" : "ghost"}
        disabled={!canRemove || removeBlocked || remove.isPending}
        onClick={() => setConfirmRemove(true)}
      >
        {isYou ? "Leave" : "Remove"}
      </Button>

      {soleOwner ? (
        <Text variant="caption" tone="muted" className="basis-full leading-snug">
          The only owner. Promote somebody else to owner before changing or removing this one — a workspace
          with no owner cannot grant roles again.
        </Text>
      ) : null}

      <DestructiveConfirmDialog
        open={confirmRemove}
        title={isYou ? "Leave this workspace?" : `Remove ${name}?`}
        description={
          isYou ? (
            <>
              You lose access immediately, including to every workflow, run and connection in it. An admin can
              invite you back, but you cannot let yourself back in.
            </>
          ) : (
            <>
              They lose access on their next request. Their name stays on the runs they started and on the audit
              log — removal ends access, it does not rewrite history. Re-inviting them restores this membership.
            </>
          )
        }
        confirmLabel={isYou ? "Leave workspace" : "Remove member"}
        pending={remove.isPending}
        onOpenChange={(open) => { if (!open) setConfirmRemove(false); }}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}

/* ── Invitations ──────────────────────────────────────────────────────────── */

function InvitePanel({
  workspaceId, canManage, invitations, onChanged,
}: {
  workspaceId: string | null;
  canManage: boolean;
  invitations: ReturnType<typeof useQuery<{ invitations: Invitation[] }, Error>>;
  onChanged: () => void;
}) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("developer");
  const [status, setStatus] = React.useState<SaveState>(null);
  const [lastLink, setLastLink] = React.useState<string | null>(null);
  const [delivery, setDelivery] = React.useState<EmailDelivery | null>(null);

  const invite = useMutation({
    mutationFn: async () =>
      readJson<{ invitation: Invitation; acceptUrl: string; delivery: EmailDelivery }>(
        await fetch(`/api/workspaces/${encodeURIComponent(workspaceId!)}/invitations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), role }),
        }),
        "The invitation could not be created",
      ),
    onSuccess: (result) => {
      setEmail("");
      setLastLink(result.acceptUrl);
      setDelivery(result.delivery);
      // Two different outcomes, said differently. "Invited" over a mail failure
      // is the reason nobody knew the emails were not going out.
      setStatus(
        result.delivery.sent
          ? { tone: "ok", text: `Invitation emailed to ${result.invitation.email}. The link expires in 72 hours.` }
          : { tone: "error", text: `${result.invitation.email} was invited, but the email did not send.` },
      );
      onChanged();
    },
    onError: (error: Error) => setStatus({ tone: "error", text: error.message }),
  });

  const revoke = useMutation({
    mutationFn: async (invitationId: string) =>
      readJson<Invitation>(
        await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId!)}/invitations?invitationId=${encodeURIComponent(invitationId)}`,
          { method: "DELETE" },
        ),
        "The invitation could not be revoked",
      ),
    onSuccess: () => { setStatus({ tone: "ok", text: "Invitation revoked. The link stops working immediately." }); onChanged(); },
    onError: (error: Error) => setStatus({ tone: "error", text: error.message }),
  });

  const pending = (invitations.data?.invitations ?? []).filter(
    (invitation) => invitation.state === "pending",
  );
  const history = (invitations.data?.invitations ?? []).filter(
    (invitation) => invitation.state !== "pending",
  );

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <Panel
      title="Invitations"
      help={
        canManage
          ? "An invitation is a single-use link that expires in 72 hours. Only its hash is stored, so the emailed link is the only copy."
          : "Inviting people needs the admin or owner role."
      }
      footer={
        <>
          <StatusLine
            state={status}
            resting="Ownership is transferred from the members list above, not invited."
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!canManage || !emailValid}
            loading={invite.isPending}
            loadingLabel="Inviting"
            iconLeft={<Icon icon={PaperPlaneTilt} size="sm" decorative />}
            onClick={() => { setStatus(null); setLastLink(null); setDelivery(null); invite.mutate(); }}
          >
            Send invitation
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <Field
          label="Email address"
          error={email.trim() && !emailValid ? "Enter a valid email address." : undefined}
          disabled={!canManage}
        >
          <Input
            type="email"
            value={email}
            placeholder="teammate@company.com"
            disabled={!canManage}
            onChange={(event) => { setEmail(event.target.value); setStatus(null); }}
          />
        </Field>
        <Field label="Role" disabled={!canManage}>
          <Select
            value={role}
            disabled={!canManage}
            onValueChange={(value) => setRole(value as Role)}
            options={ROLE_OPTIONS.filter((option) => option.value !== "owner")}
          />
        </Field>
      </div>

      {delivery && !delivery.sent ? (
        <AdminInlineState
          tone="waiting"
          title={
            delivery.configured
              ? "The invitation exists, but the email did not send"
              : "Email is not configured for this deployment"
          }
          body={
            <>
              {delivery.reason ?? "The email provider did not accept the message."}{" "}
              The invitation itself is valid — send them the link below and it works exactly the same.
            </>
          }
        />
      ) : null}

      {lastLink ? (
        <div
          className={cn(
            "grid gap-1.5 rounded-md border p-2.5",
            delivery?.sent
              ? "border-accent-border bg-accent-subtle"
              : "border-status-waiting-border bg-status-waiting-subtle",
          )}
        >
          <Text variant="caption" tone="secondary" className="block leading-snug">
            {delivery?.sent
              ? "The invitation email has been sent. This link is the same one it contains — shown once, and it cannot be read back."
              : "Send this link to them directly. It is shown once and cannot be read back, so copy it before you leave this page."}
          </Text>
          <div className="flex flex-wrap items-center gap-2">
            <Text variant="mono-sm" tone="primary" className="min-w-0 flex-1 truncate">{lastLink}</Text>
            <Button
              size="xs"
              variant="secondary"
              iconLeft={<Icon icon={Copy} size="sm" decorative />}
              onClick={() => void navigator.clipboard?.writeText(lastLink)}
            >
              Copy
            </Button>
          </div>
        </div>
      ) : null}

      {invitations.error ? (() => {
        const described = describeAdminFailure(invitations.error, "invitations");
        return <AdminInlineState tone={described.tone} title={described.title} body={described.body} />;
      })() : null}

      {invitations.data && pending.length === 0 && history.length === 0 ? (
        <AdminInlineState
          tone="neutral"
          title="Nobody is waiting on an invitation"
          body="Invite somebody above and they appear here until they accept, the link expires, or you revoke it."
        />
      ) : null}

      {pending.length > 0 ? (
        <ul className="border-subtle divide-subtle divide-y rounded-md border">
          {pending.map((invitation) => (
            <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <Text variant="body-sm" tone="primary" className="block truncate">{invitation.email}</Text>
                <Text variant="caption" tone="muted" className="block truncate">
                  {ROLE_LABEL[invitation.role]} · invited by {invitation.inviterName} · expires{" "}
                  <RelativeTime iso={invitation.expiresAt} />
                </Text>
              </span>
              <Button
                size="xs"
                variant="ghost"
                disabled={!canManage || revoke.isPending}
                onClick={() => { setStatus(null); revoke.mutate(invitation.id); }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {history.length > 0 ? (
        <details className="group">
          <summary className="text-fg-muted font-ui text-caption cursor-pointer list-none outline-none focus-visible:focus-ring rounded-xs">
            {history.length} past invitation{history.length === 1 ? "" : "s"}
          </summary>
          <ul className="border-subtle divide-subtle mt-2 divide-y rounded-md border">
            {history.slice(0, 20).map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <Text variant="caption" tone="secondary" className="min-w-0 flex-1 truncate">
                  {invitation.email}
                </Text>
                <span
                  className={cn(
                    "font-ui text-caption rounded-full border px-1.5 capitalize",
                    invitation.state === "accepted"
                      ? "border-status-success-border bg-status-success-subtle text-status-success"
                      : "border-subtle bg-surface-sunken text-fg-muted",
                  )}
                >
                  {invitation.state}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

/* ── Atoms ────────────────────────────────────────────────────────────────── */

function Avatar({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = React.useState(false);
  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote avatar, not a build-time asset
      <img
        src={url}
        alt=""
        onError={() => setBroken(true)}
        className="border-subtle size-8 shrink-0 rounded-full border object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="bg-accent-subtle text-accent grid size-8 shrink-0 place-items-center rounded-full"
    >
      <Text variant="caption" tone="inherit">{name.slice(0, 1).toUpperCase()}</Text>
    </span>
  );
}

function RowSkeleton({ rows }: { rows: number }) {
  return (
    <div className="border-subtle divide-subtle divide-y rounded-md border" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-2.5">
          <div className="bg-surface-active size-8 shrink-0 animate-pulse rounded-full" />
          <div className="flex-1">
            <div className="bg-surface-active h-3 w-40 animate-pulse rounded-xs" />
            <div className="bg-surface-active mt-1.5 h-2.5 w-56 animate-pulse rounded-xs" />
          </div>
          <div className="bg-surface-active h-7 w-40 shrink-0 animate-pulse rounded-md" />
        </div>
      ))}
    </div>
  );
}
