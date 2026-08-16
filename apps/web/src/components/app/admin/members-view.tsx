"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "~/lib/cn";
import { PageContainer, PageHeader } from "~/components/ui/page";
import { Text } from "~/components/ui/text";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { Checkbox } from "~/components/ui/choice";
import { RelativeTime } from "~/components/app/workflows/atoms";
import { EMPTY } from "~/lib/format";
import {
  MEMBERS, INVITES, ROLES, ROLE_HELP, PERMISSIONS, roleHas, currentMember,
  type Member, type Role, type Permission,
} from "~/mocks/admin";
import type { Environment } from "~/mocks/domain";

/* ══════════════════════════════════════════════════════════════════════════════
   MEMBERS

   ONE SOURCE OF TRUTH FOR ROLE. The current product shows "Your role: Viewer"
   beside a row saying Owner, because the header and the table derive it
   separately. Everything here reads `currentMember()`, so the two cannot
   disagree — and the viewer's own row is marked rather than described twice.

   THE RBAC MATRIX IS WHAT CUSTOMERS ASK FOR. Not a paragraph per role, a grid:
   role across, permission down, so "can an Operator publish" is answered by
   looking rather than by reading.
══════════════════════════════════════════════════════════════════════════════ */

const CATEGORY_LABEL: Record<Permission["category"], string> = {
  workflows: "Workflows",
  operations: "Operations",
  governance: "Governance",
  workspace: "Workspace",
};

export function MembersView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab = params.get("tab") ?? "members";
  const inviting = params.get("invite") === "1";
  const me = currentMember();

  const setParams = React.useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    router.replace(`${pathname}?${next.toString()}` as never, { scroll: false });
  }, [params, pathname, router]);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = React.useState<Role | null>(null);

  const canManage = roleHas(me.role, "member-manage");

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Govern"
        title="Members"
        description="Who has access, what each role can do, and who is waiting on an invitation."
        metadata={
          // The single source of truth, rendered once.
          <Text variant="caption" tone="secondary">
            You are signed in as <strong className="font-medium">{me.name}</strong> with the{" "}
            <strong className="font-medium">{me.role}</strong> role.
          </Text>
        }
        actions={
          <Button variant="primary" size="sm" disabled={!canManage} onClick={() => setParams({ invite: "1" })}>
            Invite a member
          </Button>
        }
      />

      <div role="tablist" aria-label="Members sections" className="border-subtle mb-3 flex items-center gap-0.5 border-b">
        {[
          { id: "members", label: `Members (${MEMBERS.length})` },
          { id: "invites", label: `Pending invites (${INVITES.length})` },
          { id: "roles", label: "Roles and permissions" },
        ].map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParams({ tab: t.id })}
            className={cn(
              "font-ui text-body-sm -mb-px border-b-2 px-3 py-2",
              "transition-colors duration-fast outline-none focus-visible:focus-ring",
              tab === t.id ? "border-accent text-fg-primary" : "border-transparent text-fg-muted hover:text-fg-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "members" ? (
        <MemberTable
          selected={selected}
          onToggle={(id) => setSelected((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
          canManage={canManage}
          meId={me.id}
        />
      ) : null}

      {tab === "invites" ? <Invites canManage={canManage} /> : null}
      {tab === "roles" ? <RbacMatrix currentRole={me.role} /> : null}

      {selected.size > 0 && canManage ? (
        <BulkBar
          count={selected.size}
          role={bulkRole}
          onRole={setBulkRole}
          onClear={() => { setSelected(new Set()); setBulkRole(null); }}
        />
      ) : null}

      <InviteDialog open={inviting} onClose={() => setParams({ invite: null })} />
    </PageContainer>
  );
}

/* ── Table ────────────────────────────────────────────────────────────────── */

function MemberTable({
  selected, onToggle, canManage, meId,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  canManage: boolean;
  meId: string;
}) {
  return (
    <div className="border-subtle bg-surface-raised overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[56rem]">
        <caption className="sr-only">Workspace members</caption>
        <thead>
          <tr className="border-subtle bg-surface-sunken text-fg-muted font-ui text-eyebrow border-b uppercase">
            <th scope="col" className="w-9 px-3 py-2" />
            <th scope="col" className="px-3 py-2 text-left font-normal">Member</th>
            <th scope="col" className="px-3 py-2 text-left font-normal">Role</th>
            <th scope="col" className="px-3 py-2 text-left font-normal">Status</th>
            <th scope="col" className="px-3 py-2 text-left font-normal">Last active</th>
            <th scope="col" className="px-3 py-2 text-right font-normal">Workflows</th>
            <th scope="col" className="px-3 py-2 text-right font-normal">2FA</th>
          </tr>
        </thead>
        <tbody>
          {MEMBERS.map((member) => (
            <tr key={member.id} className="border-subtle border-b last:border-b-0">
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(member.id)}
                  onChange={() => onToggle(member.id)}
                  disabled={!canManage || member.role === "Owner"}
                  aria-label={`Select ${member.name}`}
                  title={member.role === "Owner" ? "The Owner's role cannot be changed in bulk" : undefined}
                  className="accent-accent size-3.5 rounded-xs outline-none focus-visible:focus-ring disabled:opacity-40"
                />
              </td>
              <td className="px-3 py-2">
                <span className="flex min-w-0 flex-col justify-center leading-tight">
                  <span className="flex items-center gap-1.5">
                    <Text variant="body-sm" tone="primary" className="truncate">{member.name}</Text>
                    {member.id === meId ? (
                      <span className="border-accent-border text-accent font-ui rounded-xs border px-1 text-[10px]">you</span>
                    ) : null}
                  </span>
                  <Text variant="caption" tone="muted" className="truncate">{member.email}</Text>
                </span>
              </td>
              <td className="px-3 py-2">
                <span className="flex min-w-0 flex-col justify-center leading-tight">
                  <Text variant="caption" tone="secondary">{member.role}</Text>
                  {member.environments ? (
                    <Text variant="caption" tone="disabled" className="truncate">
                      {member.environments.join(", ")} only
                    </Text>
                  ) : null}
                </span>
              </td>
              <td className="px-3 py-2">
                <Text
                  variant="caption"
                  tone="inherit"
                  className={
                    member.status === "active" ? "text-status-success"
                      : member.status === "suspended" ? "text-status-failed" : "text-status-waiting"
                  }
                >
                  {member.status}
                </Text>
              </td>
              <td className="px-3 py-2">
                {member.lastActiveAt ? (
                  <Text variant="caption" tone="secondary" tabular><RelativeTime iso={member.lastActiveAt} /></Text>
                ) : (
                  <Text variant="caption" tone="disabled">{EMPTY}</Text>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <Text variant="caption" tone="secondary" tabular>{member.workflowsOwned}</Text>
              </td>
              <td className="px-3 py-2 text-right">
                {member.twoFactor ? (
                  <Text variant="caption" tone="inherit" className="text-status-success">On</Text>
                ) : (
                  <Text
                    variant="caption"
                    tone="inherit"
                    className="text-status-waiting"
                    title="This member can sign in with a password alone"
                  >
                    Off
                  </Text>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── RBAC matrix ──────────────────────────────────────────────────────────── */

function RbacMatrix({ currentRole }: { currentRole: Role }) {
  const categories = ["workflows", "operations", "governance", "workspace"] as const;

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-5">
        {ROLES.map((role) => (
          <div
            key={role}
            className={cn(
              "rounded-md border p-2.5",
              role === currentRole ? "border-accent-border bg-surface-selected" : "border-subtle bg-surface-raised",
            )}
          >
            <Text variant="body-sm" tone={role === currentRole ? "max" : "primary"} className="block">
              {role}
              {role === currentRole ? <span className="sr-only"> — your role</span> : null}
            </Text>
            <Text variant="caption" tone="muted" className="mt-0.5 block leading-snug">{ROLE_HELP[role]}</Text>
          </div>
        ))}
      </div>

      <div className="border-subtle bg-surface-raised overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[48rem]">
          <caption className="sr-only">What each role can do</caption>
          <thead>
            <tr className="border-subtle bg-surface-sunken text-fg-muted font-ui text-eyebrow border-b uppercase">
              <th scope="col" className="px-3 py-2 text-left font-normal">Permission</th>
              {ROLES.map((role) => (
                <th
                  key={role}
                  scope="col"
                  className={cn("px-3 py-2 text-center font-normal", role === currentRole && "text-accent")}
                >
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <React.Fragment key={category}>
                <tr className="bg-surface-sunken">
                  <th scope="colgroup" colSpan={ROLES.length + 1} className="px-3 py-1 text-left">
                    <Text variant="caption" tone="muted">{CATEGORY_LABEL[category]}</Text>
                  </th>
                </tr>
                {PERMISSIONS.filter((p) => p.category === category).map((permission) => (
                  <tr key={permission.id} className="border-subtle border-b last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <Text variant="body-sm" tone="primary" className="block">{permission.label}</Text>
                      <Text variant="caption" tone="muted" className="block leading-snug">{permission.help}</Text>
                    </th>
                    {ROLES.map((role) => {
                      const has = permission.roles.includes(role);
                      return (
                        <td
                          key={role}
                          className={cn("px-3 py-2 text-center", role === currentRole && "bg-surface-selected")}
                        >
                          {/* A tick and a dash, not colour alone. */}
                          {has ? (
                            <svg viewBox="0 0 12 12" className="text-status-success mx-auto size-3.5" role="img" aria-label={`${role} can ${permission.label.toLowerCase()}`}>
                              <path d="M2.5 6.4 5 8.8 9.5 3.6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 12 12" className="text-fg-disabled mx-auto size-3.5" role="img" aria-label={`${role} cannot ${permission.label.toLowerCase()}`}>
                              <path d="M3.5 6h5" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />
                            </svg>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <Text variant="caption" tone="muted" className="block leading-snug">
        Roles are fixed rather than composable. A customer asking &ldquo;what can this person
        do&rdquo; gets one answer from this grid, which is worth more than the flexibility of custom
        roles that nobody can audit.
      </Text>
    </div>
  );
}

/* ── Invites ──────────────────────────────────────────────────────────────── */

function Invites({ canManage }: { canManage: boolean }) {
  if (INVITES.length === 0) {
    return (
      <div className="border-subtle grid place-items-center rounded-lg border border-dashed px-4 py-12">
        <Text variant="body-sm" tone="secondary">No invitations outstanding.</Text>
      </div>
    );
  }

  return (
    <ul className="grid gap-2">
      {INVITES.map((invite) => {
        const expired = Date.parse(invite.expiresAt) < Date.now();
        return (
          <li
            key={invite.id}
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-md border p-3",
              expired ? "border-status-waiting-border bg-status-waiting-subtle" : "border-subtle bg-surface-raised",
            )}
          >
            <span className="min-w-0 flex-1">
              <Text variant="body-sm" tone="primary" className="block truncate">{invite.email}</Text>
              <Text variant="caption" tone="muted" className="block">
                {invite.role}
                {invite.environments ? ` · ${invite.environments.join(", ")} only` : ""} · invited by{" "}
                {invite.invitedBy} <RelativeTime iso={invite.invitedAt} />
              </Text>
            </span>
            <Text
              variant="caption"
              tone={expired ? "inherit" : "muted"}
              className={expired ? "text-status-waiting" : undefined}
            >
              {expired ? "Expired" : <>expires <RelativeTime iso={invite.expiresAt} /></>}
            </Text>
            <span className="flex gap-1.5">
              <Button size="xs" variant="secondary" disabled={!canManage}>
                {expired ? "Send again" : "Resend"}
              </Button>
              <Button size="xs" variant="ghost" disabled={!canManage} className="text-status-failed">Revoke</Button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Bulk ─────────────────────────────────────────────────────────────────── */

function BulkBar({
  count, role, onRole, onClear,
}: {
  count: number;
  role: Role | null;
  onRole: (role: Role) => void;
  onClear: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-sticky flex justify-center p-3">
        <div
          data-motion="decorative"
          className={cn(
            "bg-surface-overlay border-default shadow-3 pointer-events-auto",
            "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2",
            "motion-safe:animate-[ink-drawer-in_180ms_var(--ease-standard)]",
          )}
        >
          <Text variant="body-sm" tone="primary" className="font-medium">
            <span className="tabular">{count}</span> selected
          </Text>
          <Select
            options={ROLES.filter((r) => r !== "Owner").map((r) => ({ value: r, label: r }))}
            value={role ?? ""}
            onValueChange={(v) => onRole(v as Role)}
            placeholder="Change role to…"
            aria-label="New role"
          />
          <Button size="sm" variant="primary" disabled={!role} onClick={() => setConfirming(true)}>
            Apply
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>Cancel</Button>
        </div>
      </div>

      <Dialog.Root open={confirming} onOpenChange={setConfirming}>
        <Dialog.Portal>
          <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
          <Dialog.Content
            aria-describedby={undefined}
            className={cn(
              "motion-overlay z-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
              "bg-surface-overlay border-subtle shadow-3 w-[min(30rem,calc(100vw-2rem))] rounded-lg border p-4",
            )}
          >
            <Dialog.Title asChild>
              <Text variant="heading-sm" tone="max" as="h2">Change {count} {count === 1 ? "role" : "roles"}</Text>
            </Dialog.Title>
            <Text variant="body-sm" tone="secondary" className="mt-1 block">
              {count} {count === 1 ? "member becomes" : "members become"} {role}. {role ? ROLE_HELP[role] : ""}
            </Text>
            <Text variant="caption" tone="muted" className="mt-1 block leading-snug">
              Takes effect on their next request — anyone signed in now keeps their current
              permissions until then.
            </Text>
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button variant="primary" size="sm" onClick={() => { setConfirming(false); onClear(); }}>
                Change {count} to {role}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/* ── Invite ───────────────────────────────────────────────────────────────── */

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<Role>("Developer");
  const [restrict, setRestrict] = React.useState(false);
  const [environments, setEnvironments] = React.useState<Environment[]>(["staging"]);
  const [days, setDays] = React.useState(7);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "motion-overlay z-modal fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
            "bg-surface-overlay border-subtle shadow-3 w-[min(32rem,calc(100vw-2rem))] rounded-lg border p-4",
          )}
        >
          <Dialog.Title asChild>
            <Text variant="heading-sm" tone="max" as="h2">Invite a member</Text>
          </Dialog.Title>

          <div className="mt-3 grid gap-3">
            <label className="grid gap-1">
              <Text variant="caption" tone="secondary">Email</Text>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@acme.example" className="h-8 text-body-sm" />
              <Text variant="caption" tone="muted">Must match an allowed domain in Security settings.</Text>
            </label>

            <label className="grid gap-1">
              <Text variant="caption" tone="secondary">Role</Text>
              <Select
                options={ROLES.filter((r) => r !== "Owner").map((r) => ({ value: r, label: r }))}
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                aria-label="Role"
              />
              <Text variant="caption" tone="muted">{ROLE_HELP[role]}</Text>
            </label>

            <div className="grid gap-1">
              <Checkbox checked={restrict} onCheckedChange={(v) => setRestrict(v === true)}>
                Restrict to specific environments
              </Checkbox>
              {restrict ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(["production", "staging", "development"] as Environment[]).map((env) => (
                    <button
                      key={env}
                      type="button"
                      onClick={() => setEnvironments((e) => e.includes(env) ? e.filter((x) => x !== env) : [...e, env])}
                      aria-pressed={environments.includes(env)}
                      className={cn(
                        "font-ui text-caption rounded-full border px-2.5 py-1 capitalize",
                        "transition-colors duration-fast outline-none focus-visible:focus-ring",
                        environments.includes(env)
                          ? "bg-accent-subtle border-accent-border text-accent"
                          : "border-subtle text-fg-secondary",
                      )}
                    >
                      {env}
                    </button>
                  ))}
                </div>
              ) : null}
              <Text variant="caption" tone="muted" className="leading-snug">
                A restricted member holds their role only in those environments. Elsewhere they read
                and nothing more.
              </Text>
            </div>

            <label className="grid gap-1">
              <Text variant="caption" tone="secondary">Invitation expires after</Text>
              <Input
                type="number" min={1} max={30}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                className="h-8 text-body-sm"
              />
              <Text variant="caption" tone="muted">Days. An unaccepted invitation is a live credential, so shorter is better.</Text>
            </label>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button variant="primary" size="sm" disabled={!email.includes("@")}>Send the invitation</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
