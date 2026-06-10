"use client";

import {
  AlertTriangle,
  BarChart2,
  Check,
  Clock,
  Code2,
  CreditCard,
  Crown,
  Eye,
  KeyRound,
  Lock,
  Mail,
  Rocket,
  ScrollText,
  Shield,
  Trash2,
  UserCircle,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { toast } from "sonner";

import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/page-kit";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

// ─── Member types ─────────────────────────────────────────────────────────────

type MemberRole = "owner" | "admin" | "editor" | "viewer";

interface Member {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  role: MemberRole;
  joinedAt: string;
}

interface PendingInvitation {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const ROLE_CONFIG: Record<MemberRole, { label: string; icon: typeof Crown; tone: "green" | "teal" | "gray" | "violet" }> = {
  owner:  { label: "Owner",  icon: Crown,  tone: "violet" },
  admin:  { label: "Admin",  icon: Crown,  tone: "green"  },
  editor: { label: "Editor", icon: Shield, tone: "teal"   },
  viewer: { label: "Viewer", icon: Eye,    tone: "gray"   },
};

// ─── Settings directory ───────────────────────────────────────────────────────

const DIRECTORY: { href: Route; label: string; desc: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { href: "/settings/members" as never,              label: "Members",              desc: "Team & invitations",       icon: Users },
  { href: "/settings/usage" as never,                label: "Usage & limits",       desc: "Runs, tokens, quotas",     icon: BarChart2 },
  { href: "/settings/billing" as never,              label: "Billing",              desc: "Plan & payment",           icon: CreditCard },
  { href: "/api-keys" as never,                      label: "API keys",             desc: "Programmatic access",      icon: KeyRound, adminOnly: true },
  { href: "/settings/profile" as never,              label: "Profile",              desc: "Your account",             icon: UserCircle },
  { href: "/settings/audit" as never,                label: "Audit log",            desc: "Workspace activity",       icon: ScrollText },
  { href: "/settings/privacy" as never,              label: "Privacy",              desc: "Data & retention",         icon: Lock },
  { href: "/settings/production-readiness" as never, label: "Production readiness", desc: "Go-live checklist",        icon: Rocket },
  { href: "/settings/sdk" as never,                  label: "SDK",                  desc: "Client libraries",         icon: Code2 },
];

// ─── Local primitives ─────────────────────────────────────────────────────────

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-[12px] border border-[#E0E3E6] bg-white", className)}>{children}</div>;
}

function PanelHead({ label, title, desc, action }: { label: string; title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#ECEEEF] px-5 py-4">
      <div>
        <span className="vb-mono-label">{label}</span>
        <p className="mt-0.5 text-[15px] font-bold tracking-[-0.01em] text-[#0B0D0F]">{title}</p>
        {desc && <p className="mt-0.5 text-[12.5px] text-[#6B7280]">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

function Avatar({ member }: { member: Member }) {
  const initials = member.displayName.slice(0, 2).toUpperCase();
  return member.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={member.avatarUrl} alt={member.displayName}
      className="h-8 w-8 rounded-full border border-[#E0E3E6] object-cover" />
  ) : (
    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#9CCFBB] bg-[#E6F4EF] text-[11px] font-bold text-[#006B45]">
      {initials}
    </span>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { activeWorkspace, activeWorkspaceId, role, planTier, seatUsage } = useWorkspace();
  const [resetOpen, setResetOpen] = useState(false);

  // Members state
  const [members, setMembers]           = useState<Member[]>([]);
  const [invitations, setInvitations]   = useState<PendingInvitation[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [inviteOpen, setInviteOpen]     = useState(false);
  const [inviteEmail, setInviteEmail]   = useState("");
  const [inviteRole, setInviteRole]     = useState<MemberRole>("editor");
  const [inviting, setInviting]         = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setLoadingMembers(true);
    Promise.all([
      fetch(`/api/workspaces/${activeWorkspaceId}/members`).then(r => r.json()),
      fetch(`/api/workspaces/${activeWorkspaceId}/invitations`).then(r => r.json()).catch(() => []),
    ])
      .then(([m, inv]: [unknown, unknown]) => {
        if (Array.isArray(m))   setMembers(m as Member[]);
        if (Array.isArray(inv)) setInvitations(inv as PendingInvitation[]);
      })
      .catch(() => {})
      .finally(() => setLoadingMembers(false));
  }, [activeWorkspaceId]);

  async function handleInvite() {
    if (!activeWorkspaceId || inviting) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) { toast.error("Enter an email address."); return; }
    if (members.some(m => m.email.toLowerCase() === email)) {
      toast.error("This person is already a member.");
      return;
    }
    setInviting(true);
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: inviteRole }),
      });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "Failed");
      const inv = await res.json() as PendingInvitation;
      setInvitations(prev => [inv, ...prev]);
      setInviteEmail("");
      setInviteOpen(false);
      toast.success(`Invitation sent to ${email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send invitation");
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvite(id: string) {
    if (!activeWorkspaceId) return;
    try {
      await fetch(
        `/api/workspaces/${activeWorkspaceId}/invitations?invitationId=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      setInvitations(prev => prev.filter(i => i.id !== id));
      toast.success("Invitation revoked.");
    } catch { toast.error("Failed to revoke invitation."); }
  }

  const confirmReset = () => {
    setResetOpen(false);
    toast.success("Workspace reset request submitted.", {
      description: "Agent jobs and run history will be removed. Audit logs are retained for compliance.",
    });
  };

  const isAdmin = role === "admin";
  const seatPct = seatUsage.max > 0 ? Math.min(100, Math.round((seatUsage.used / seatUsage.max) * 100)) : 0;
  const pendingInvites = invitations.filter(i => !i.acceptedAt && !i.revokedAt);
  const visibleDirectory = DIRECTORY.filter(d => !d.adminOnly || isAdmin);

  return (
    <div className="min-h-screen">
      <AppHeader eyebrow="Workspace" title="Settings" subtitle="Configuration, team and account management." />

      <div className="space-y-4 px-4 py-6 md:px-6 xl:px-8">

        {/* ── Settings directory ── */}
        <div className="animate-slide-up">
          <span className="vb-mono-label mb-2.5 block">Browse settings</span>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
            {visibleDirectory.map(({ href, label, desc, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-start gap-2.5 rounded-[10px] border border-[#E0E3E6] bg-white p-3 transition-all hover:-translate-y-px hover:border-[#9CCFBB] hover:shadow-[0_4px_14px_rgba(11,13,15,0.05)]"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-[#F3F4F5] text-[#6B7280] transition-colors group-hover:bg-[#E6F4EF] group-hover:text-[#007F4E]">
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-[#0B0D0F]">{label}</span>
                  <span className="block truncate text-[11px] text-[#9CA3AF]">{desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">

          {/* ── Workspace ── */}
          <Panel className="animate-slide-up stagger-1">
            <PanelHead label="General" title="Workspace" desc="Your workspace display name." />
            <div className="space-y-4 p-5">
              <div>
                <label className="mb-2 block font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">
                  Workspace name
                </label>
                <Input defaultValue={activeWorkspace?.name ?? "My Workspace"} />
              </div>
              <div className="flex justify-end">
                <Button onClick={() => toast.success("Workspace name saved.")}>
                  <Check className="h-4 w-4" />
                  Save
                </Button>
              </div>
            </div>
          </Panel>

          {/* ── Access & Plan ── */}
          <Panel className="animate-slide-up stagger-1">
            <PanelHead label="Access" title="Plan & permissions" desc="Current role, plan tier and seat usage." />
            <div className="space-y-3 p-5">
              <div className="flex items-center justify-between rounded-[9px] border border-[#ECEEEF] bg-[#FAFBFB] px-4 py-2.5">
                <span className="flex items-center gap-2 text-[13px] text-[#4B5563]"><Shield className="h-3.5 w-3.5 text-[#9CA3AF]" /> Your role</span>
                <Chip tone={ROLE_CONFIG[(role as MemberRole)]?.tone ?? "gray"} dot={false}>
                  <span className="capitalize">{role}</span>
                </Chip>
              </div>
              <div className="flex items-center justify-between rounded-[9px] border border-[#ECEEEF] bg-[#FAFBFB] px-4 py-2.5">
                <span className="flex items-center gap-2 text-[13px] text-[#4B5563]"><CreditCard className="h-3.5 w-3.5 text-[#9CA3AF]" /> Plan</span>
                <Chip tone="green" dot={false}><span className="capitalize">{planTier}</span></Chip>
              </div>
              <div className="rounded-[9px] border border-[#ECEEEF] bg-[#FAFBFB] px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-[13px] text-[#4B5563]"><Users className="h-3.5 w-3.5 text-[#9CA3AF]" /> Seats</span>
                  <span className="font-mono text-[12.5px] font-semibold tabular-nums text-[#0B0D0F]">
                    {seatUsage.used} / {seatUsage.max > 0 ? seatUsage.max : "∞"}
                  </span>
                </div>
                {seatUsage.max > 0 && (
                  <div className="h-[6px] overflow-hidden rounded-full bg-[#ECEEEF]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${seatPct}%`, background: seatPct >= 90 ? "#DC2626" : "#007F4E" }}
                    />
                  </div>
                )}
              </div>
            </div>
          </Panel>
        </div>

        {/* ── Members ── */}
        <Panel className="animate-slide-up stagger-2">
          <PanelHead
            label="Team"
            title="Members"
            desc={`${members.length} member${members.length !== 1 ? "s" : ""}${seatUsage.max > 0 ? ` · ${Math.max(0, seatUsage.max - seatUsage.used)} seat${seatUsage.max - seatUsage.used !== 1 ? "s" : ""} available` : ""}`}
            action={isAdmin && (
              <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2">
                    <UserPlus className="h-4 w-4" />
                    Invite member
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invite a team member</DialogTitle>
                    <DialogDescription>
                      They&apos;ll receive an email with a link to join your workspace.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <label className="block font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Email address</label>
                      <Input
                        type="email"
                        placeholder="colleague@company.com"
                        value={inviteEmail}
                        onChange={e => setInviteEmail(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && void handleInvite()}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="block font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Role</label>
                      <div className="grid grid-cols-3 gap-2">
                        {(["admin", "editor", "viewer"] as MemberRole[]).map(r => {
                          const { label, icon: Icon } = ROLE_CONFIG[r];
                          const active = inviteRole === r;
                          return (
                            <button
                              key={r}
                              type="button"
                              onClick={() => setInviteRole(r)}
                              className={cn(
                                "flex flex-col items-center gap-1.5 rounded-[10px] border p-3 text-center transition-colors",
                                active
                                  ? "border-[#9CCFBB] bg-[#E6F4EF]/60 text-[#006B45]"
                                  : "border-[#E0E3E6] text-[#6B7280] hover:bg-[#FAFBFB]",
                              )}
                            >
                              <Icon className="h-4 w-4" />
                              <span className="text-[12px] font-semibold">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="pt-1 text-[11px] leading-[1.5] text-[#9CA3AF]">
                        {inviteRole === "admin"  && "Full access — can manage members, keys, and all settings."}
                        {inviteRole === "editor" && "Can create and edit workflows, view audit logs."}
                        {inviteRole === "viewer" && "Read-only access to workflows and dashboards."}
                      </p>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button variant="ghost" onClick={() => setInviteOpen(false)}>Cancel</Button>
                      <Button onClick={() => void handleInvite()} disabled={inviting} className="gap-2">
                        <Mail className="h-4 w-4" />
                        {inviting ? "Sending…" : "Send invite"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          />
          {loadingMembers ? (
            <div className="space-y-px px-5 py-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-[#F3F4F5]" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 animate-pulse rounded bg-[#F3F4F5]" />
                    <div className="h-2.5 w-24 animate-pulse rounded bg-[#F3F4F5]" />
                  </div>
                  <div className="h-5 w-14 animate-pulse rounded-full bg-[#F3F4F5]" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Active members */}
              <div className="divide-y divide-[#F3F4F5]">
                {members.map(m => {
                  const cfg = ROLE_CONFIG[m.role as MemberRole] ?? { label: m.role, tone: "gray" as const };
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-5 py-3.5">
                      <Avatar member={m} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-semibold text-[#0B0D0F]">{m.displayName}</p>
                        <p className="truncate font-mono text-[11px] text-[#9CA3AF]">{m.email}</p>
                      </div>
                      <Chip tone={cfg.tone ?? "gray"} dot={false}>{cfg.label}</Chip>
                    </div>
                  );
                })}
                {members.length === 0 && (
                  <div className="px-5 py-8 text-center">
                    <p className="text-[13px] text-[#9CA3AF]">No members found.</p>
                  </div>
                )}
              </div>

              {/* Pending invitations */}
              {pendingInvites.length > 0 && (
                <>
                  <div className="border-t border-[#ECEEEF] px-5 pb-1 pt-4">
                    <span className="vb-mono-label">Pending invitations</span>
                  </div>
                  <div className="divide-y divide-[#F3F4F5]">
                    {pendingInvites.map(inv => (
                      <div key={inv.id} className="flex items-center gap-3 px-5 py-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-[#C9CED4] text-[#C9CED4]">
                          <Clock className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[12.5px] text-[#4B5563]">{inv.email}</p>
                          <p className="text-[11px] text-[#9CA3AF]">Invited · {ROLE_CONFIG[inv.role].label}</p>
                        </div>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => void revokeInvite(inv.id)}
                            className="shrink-0 rounded-[6px] p-1 text-[#9CA3AF] transition-colors hover:bg-[#FEF2F2] hover:text-[#B91C1C]"
                            title="Revoke invitation"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </Panel>

        {/* ── Danger zone ── */}
        <Panel className="animate-slide-up stagger-3 border-[#FECACA]">
          <div className="flex items-start justify-between gap-3 border-b border-[#FEE2E2] px-5 py-4">
            <div>
              <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-[#DC2626]">Danger zone</span>
              <p className="mt-0.5 text-[15px] font-bold tracking-[-0.01em] text-[#0B0D0F]">Irreversible actions</p>
              <p className="mt-0.5 text-[12.5px] text-[#6B7280]">Proceed with caution — these cannot be undone.</p>
            </div>
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-[#DC2626]" />
          </div>
          <div className="p-5">
            <div className="flex flex-col gap-3 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2]/60 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[13.5px] font-semibold text-[#0B0D0F]">Reset workspace</p>
                <p className="mt-0.5 text-[12px] text-[#6B7280]">
                  Remove all agent jobs and run history. Audit logs are not deleted.
                </p>
              </div>
              <Dialog open={resetOpen} onOpenChange={setResetOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 className="h-4 w-4" />
                    Reset workspace
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Reset workspace?</DialogTitle>
                    <DialogDescription>
                      This permanently deletes all agent jobs, run history, and artifacts.
                      Audit logs are not deleted. This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setResetOpen(false)}>Cancel</Button>
                    <Button variant="destructive" onClick={confirmReset}>Yes, reset</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </Panel>

      </div>
    </div>
  );
}
