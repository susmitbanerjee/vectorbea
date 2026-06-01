"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Crown,
  Eye,
  Mail,
  Plus,
  Shield,
  Trash2,
  UserPlus,
  Workflow,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/workspace-context";

// ─── Member types ─────────────────────────────────────────────────────────────

type MemberRole = "admin" | "editor" | "viewer";

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

const ROLE_CONFIG: Record<MemberRole, { label: string; icon: typeof Crown }> = {
  admin:  { label: "Admin",  icon: Crown  },
  editor: { label: "Editor", icon: Shield },
  viewer: { label: "Viewer", icon: Eye    },
};

function Avatar({ member }: { member: Member }) {
  const initials = member.displayName.slice(0, 2).toUpperCase();
  return member.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={member.avatarUrl} alt={member.displayName}
      className="h-8 w-8 rounded-full object-cover" />
  ) : (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
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

  return (
    <div className="min-h-screen">
      <AppHeader title="Settings" subtitle="Workspace configuration and team management." />

      <div className="grid gap-6 px-4 py-6 md:px-6 xl:grid-cols-2 xl:px-8">

        {/* ── Workspace name ── */}
        <Card className="animate-slide-up">
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Your workspace display name.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace name</label>
              <Input defaultValue={activeWorkspace?.name ?? "My Workspace"} />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => toast.success("Workspace name saved.")}>
                <Check className="h-4 w-4" />
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Access & Plan ── */}
        <Card className="animate-slide-up stagger-1">
          <CardHeader>
            <CardTitle>Access &amp; Plan</CardTitle>
            <CardDescription>Current permissions and seat usage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Your role",  value: role,      icon: Shield   },
              { label: "Plan",       value: planTier,  icon: Workflow },
              { label: "Seats",      value: `${seatUsage.used} / ${seatUsage.max}`, icon: Crown },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{label}</span>
                </div>
                <Badge variant="outline" className="capitalize">{value}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── Members ── */}
        <Card className="animate-slide-up stagger-2 xl:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Members</CardTitle>
                <CardDescription>
                  {members.length} member{members.length !== 1 ? "s" : ""}
                  {seatUsage.max > 0 && ` · ${seatUsage.max - seatUsage.used} seat${seatUsage.max - seatUsage.used !== 1 ? "s" : ""} available`}
                </CardDescription>
              </div>
              {isAdmin && (
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
                        <label className="text-sm font-medium">Email address</label>
                        <Input
                          type="email"
                          placeholder="colleague@company.com"
                          value={inviteEmail}
                          onChange={e => setInviteEmail(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && void handleInvite()}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Role</label>
                        <div className="grid grid-cols-3 gap-2">
                          {(["admin", "editor", "viewer"] as MemberRole[]).map(r => {
                            const { label, icon: Icon } = ROLE_CONFIG[r];
                            const active = inviteRole === r;
                            return (
                              <button
                                key={r}
                                type="button"
                                onClick={() => setInviteRole(r)}
                                className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-colors ${
                                  active
                                    ? "border-primary bg-primary/5 text-primary"
                                    : "border-border text-muted-foreground hover:bg-muted/40"
                                }`}
                              >
                                <Icon className="h-4 w-4" />
                                <span className="text-[12px] font-semibold">{label}</span>
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-muted-foreground pt-1">
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
            </div>
          </CardHeader>
          <CardContent className="space-y-1 p-0">
            {loadingMembers ? (
              <div className="space-y-px px-6 py-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3 py-2.5">
                    <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                      <div className="h-2.5 w-24 animate-pulse rounded bg-muted" />
                    </div>
                    <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Active members */}
                <div className="divide-y divide-border/40">
                  {members.map(m => {
                    const { label } = ROLE_CONFIG[m.role];
                    return (
                      <div key={m.id} className="flex items-center gap-3 px-6 py-3.5">
                        <Avatar member={m} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13.5px] font-semibold text-foreground truncate">{m.displayName}</p>
                          <p className="text-[11.5px] text-muted-foreground truncate">{m.email}</p>
                        </div>
                        <Badge variant="outline" className="text-[11px] capitalize shrink-0">{label}</Badge>
                      </div>
                    );
                  })}
                  {members.length === 0 && (
                    <div className="px-6 py-8 text-center">
                      <p className="text-sm text-muted-foreground">No members found.</p>
                    </div>
                  )}
                </div>

                {/* Pending invitations */}
                {invitations.filter(i => !i.acceptedAt && !i.revokedAt).length > 0 && (
                  <>
                    <div className="border-t border-border/40 px-6 pb-1 pt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Pending invitations
                      </p>
                    </div>
                    <div className="divide-y divide-border/40">
                      {invitations
                        .filter(i => !i.acceptedAt && !i.revokedAt)
                        .map(inv => (
                          <div key={inv.id} className="flex items-center gap-3 px-6 py-3">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground/40">
                              <Clock className="h-3.5 w-3.5" />
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] text-muted-foreground truncate">{inv.email}</p>
                              <p className="text-[11px] text-muted-foreground/60">Invited · {ROLE_CONFIG[inv.role].label}</p>
                            </div>
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => void revokeInvite(inv.id)}
                                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
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
          </CardContent>
        </Card>

        {/* ── Danger zone ── */}
        <Card className="animate-slide-up stagger-3 border-destructive/40 xl:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <CardTitle>Danger zone</CardTitle>
            </div>
            <CardDescription>Irreversible actions. Proceed with caution.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-medium">Reset workspace</p>
                <p className="text-xs text-muted-foreground">
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
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
