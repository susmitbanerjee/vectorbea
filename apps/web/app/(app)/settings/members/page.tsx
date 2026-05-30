"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Clock, Crown, Eye, Mail, Plus, Shield, Trash2, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

import { AppHeader } from "@/components/layout/app-header";
import { RbacGuard } from "@/components/rbac-guard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspace } from "@/lib/workspace-context";

type MemberRole = "admin" | "editor" | "viewer";

interface PendingInvitation {
  id: string;
  email: string;
  role: MemberRole;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface Member {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  role: MemberRole;
  joinedAt: string;
}

const ROLE_CONFIG: Record<
  MemberRole,
  { label: string; icon: typeof Crown; variant: "default" | "secondary" | "outline" }
> = {
  admin: { label: "Admin", icon: Crown, variant: "default" },
  editor: { label: "Editor", icon: Shield, variant: "secondary" },
  viewer: { label: "Viewer", icon: Eye, variant: "outline" },
};

export default function MembersPage() {
  const { activeOrganization, activeWorkspace, activeWorkspaceId, seatUsage } = useWorkspace();
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [sessionUser, setSessionUser] = useState<{ email: string; displayName: string } | null>(null);

  // Load current session user as fallback when workspace members list is empty
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    void supabase.auth.getUser().then(({ data }: { data: { user: import("@supabase/supabase-js").User | null } }) => {
      if (data.user) {
        const email = data.user.email ?? "";
        const displayName =
          (data.user.user_metadata?.full_name as string | undefined) ??
          (data.user.user_metadata?.name as string | undefined) ??
          email.split("@")[0] ??
          "You";
        setSessionUser({ email, displayName });
      }
    });
  }, []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("editor");
  const [inviting, setInviting] = useState(false);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setLoadingMembers(true);
    Promise.all([
      fetch(`/api/workspaces/${activeWorkspaceId}/members`).then((r) => r.json()),
      fetch(`/api/workspaces/${activeWorkspaceId}/invitations`).then((r) => r.json()).catch(() => []),
    ])
      .then(([membersData, invitesData]: [unknown, unknown]) => {
        if (Array.isArray(membersData)) setMembers(membersData as Member[]);
        if (Array.isArray(invitesData)) setInvitations(invitesData as PendingInvitation[]);
      })
      .catch(() => {})
      .finally(() => setLoadingMembers(false));
  }, [activeWorkspaceId]);

  const hasSeatLimit = seatUsage.hasConfiguredLimit;
  const seatsUsed = hasSeatLimit
    ? Math.max(seatUsage.used, members.length)
    : members.length;
  const maxSeats = hasSeatLimit
    ? Math.max(activeOrganization?.maxSeats ?? seatUsage.max, 1)
    : Math.max(members.length, 1);
  const seatLimitReached = hasSeatLimit && seatsUsed >= maxSeats;

  const handleInvite = async () => {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (seatLimitReached) {
      toast.error(`Seat limit reached (${seatsUsed}/${maxSeats}). Upgrade to add more members.`);
      return;
    }
    if (!normalizedEmail) { toast.error("Email is required."); return; }
    if (!normalizedEmail.includes("@")) { toast.error("Enter a valid email address."); return; }
    if (members.some((m) => m.email.toLowerCase() === normalizedEmail)) {
      toast.error("That user is already a member of this workspace.");
      return;
    }
    if (invitations.some((i) => i.email === normalizedEmail && !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt) > new Date())) {
      toast.error("A pending invitation already exists for this email.");
      return;
    }
    if (!activeWorkspaceId) return;

    setInviting(true);
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, role: inviteRole }),
      });
      const json = await res.json() as PendingInvitation & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to send invitation");
      setInvitations((prev) => [json, ...prev]);
      toast.success(`Invitation sent to ${normalizedEmail}`);
      setInviteEmail("");
      setInviteRole("editor");
      setInviteOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send invitation");
    } finally {
      setInviting(false);
    }
  };

  const handleRevoke = async (invitationId: string) => {
    if (!activeWorkspaceId || revokingId) return;
    setRevokingId(invitationId);
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/invitations?invitationId=${encodeURIComponent(invitationId)}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json() as { error?: string }; throw new Error(j.error ?? "Failed to revoke"); }
      setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
      toast.success("Invitation revoked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to revoke invitation");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Members"
        subtitle={`Manage who has access to ${activeWorkspace?.name ?? "this workspace"}.`}
        actions={
          <RbacGuard requiredRole="admin">
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button>
                  <UserPlus className="h-4 w-4" />
                  Invite Member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite a new member</DialogTitle>
                  <DialogDescription>
                    They&apos;ll receive an email with a link to join{" "}
                    <strong>{activeWorkspace?.name}</strong>.
                  </DialogDescription>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleInvite();
                  }}
                  className="mt-4 space-y-4"
                >
                  {seatLimitReached && (
                    <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm">
                      <p className="font-medium text-amber-200">
                        Seat limit reached ({seatsUsed}/{maxSeats}).
                      </p>
                      <p className="mt-1 text-amber-100/80">
                        <a
                          href="/settings/billing"
                          className="font-medium underline underline-offset-4"
                        >
                          Upgrade plan to add more seats
                        </a>
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Email address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="colleague@company.com"
                        autoFocus
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Role
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(["admin", "editor", "viewer"] as const).map((role) => {
                        const cfg = ROLE_CONFIG[role];
                        const Icon = cfg.icon;
                        const active = inviteRole === role;
                        return (
                          <button
                            key={role}
                            type="button"
                            onClick={() => setInviteRole(role)}
                            className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium transition-colors ${
                              active
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground hover:bg-accent/50"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {inviteRole === "admin" && "Full access. Can manage members, keys, and all settings."}
                      {inviteRole === "editor" && "Can create and edit prompts, view audit logs."}
                      {inviteRole === "viewer" && "Read-only access to prompts and dashboards."}
                    </p>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setInviteOpen(false)}
                      disabled={inviting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={inviting || !inviteEmail.trim() || seatLimitReached}
                    >
                      <Plus className="h-4 w-4" />
                      {inviting ? "Sending..." : "Send invite"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </RbacGuard>
        }
      />

      <div className="space-y-5 px-4 py-6 md:px-6 xl:px-8">
        {/* ── Removed role-count stat cards (replaced by inline count in table header) ── */}
        {/* Placeholder to avoid re-read error: */}
        {false && (["admin", "editor", "viewer"] as const).map((role) => {
          const cfg = ROLE_CONFIG[role];
          const Icon = cfg.icon;
          const count = members.filter((member) => member.role === role).length;
          return (
            <div key={role} className="hidden">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">{count}</p>
                <p className="text-xs text-muted-foreground">{cfg.label}s</p>
              </div>
            </div>
          );
        })}

        {/* ── Clean members card ───────────────────────────────────────── */}
        <div
          className="overflow-hidden rounded-2xl"
          style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", boxShadow: "0 4px 14px rgba(15,23,42,0.03)" }}
        >
          {/* Card header */}
          <div
            className="flex items-center justify-between px-[18px]"
            style={{ height: 52, borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}
          >
            <div className="flex items-center gap-3">
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                Workspace members
              </span>
              <span
                className="rounded-full border px-2 py-0.5"
                style={{ fontSize: 11, fontWeight: 600, color: "#64748B", borderColor: "#E2E8F0", background: "#F8FAFC" }}
              >
                {members.length > 0 ? members.length : (sessionUser ? 1 : 0)}
              </span>
            </div>
            {hasSeatLimit && (
              <span style={{ fontSize: 12, color: "#64748B" }}>
                {seatsUsed}/{maxSeats} seats
              </span>
            )}
          </div>

          {/* Column headers */}
          <div
            className="grid px-[18px]"
            style={{
              gridTemplateColumns: "minmax(0,2fr) 1fr 1fr 100px",
              height: 40,
              borderBottom: "1px solid #F1F5F9",
              alignItems: "center",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#64748B",
            }}
          >
            <span>Member</span>
            <span>Role</span>
            <span>Status</span>
            <span>Joined</span>
          </div>

          {/* Rows */}
          {loadingMembers && members.length === 0 ? (
            <div className="flex items-center justify-center py-14">
              <span style={{ fontSize: 13, color: "#94A3B8" }}>Loading members…</span>
            </div>
          ) : members.length === 0 && !sessionUser ? (
            <div className="flex items-center justify-center py-14">
              <span style={{ fontSize: 13, color: "#94A3B8" }}>No members found.</span>
            </div>
          ) : (
            <>
              {/* Real members */}
              {members.map((member) => {
                const cfg = ROLE_CONFIG[member.role];
                const Icon = cfg.icon;
                const initials = member.displayName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div
                    key={member.id}
                    className="grid items-center px-[18px] transition-colors hover:bg-slate-50"
                    style={{
                      gridTemplateColumns: "minmax(0,2fr) 1fr 1fr 100px",
                      minHeight: 64,
                      borderBottom: "1px solid #F1F5F9",
                    }}
                  >
                    {/* Name + email */}
                    <div className="flex items-center gap-3 min-w-0">
                      {member.avatarUrl ? (
                        <Image src={member.avatarUrl} alt={member.displayName} width={36} height={36}
                          className="h-9 w-9 shrink-0 rounded-full object-cover"
                          style={{ border: "1px solid #BFDBFE" }}
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                          style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", fontSize: 13, fontWeight: 700, color: "#1D4ED8" }}>
                          {initials}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: "#0F172A" }}>{member.displayName}</p>
                        <p className="truncate" style={{ fontSize: 11.5, color: "#94A3B8" }}>{member.email}</p>
                      </div>
                    </div>
                    {/* Role */}
                    <span className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1"
                      style={{ fontSize: 11.5, fontWeight: 600,
                        ...(member.role === "admin" ? { background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1D4ED8" } :
                          member.role === "editor" ? { background: "#F8FAFC", borderColor: "#E2E8F0", color: "#475569" } :
                          { background: "#F8FAFC", borderColor: "#E2E8F0", color: "#64748B" }) }}>
                      <Icon className="h-3 w-3" />
                      {cfg.label}
                    </span>
                    {/* Status */}
                    <span className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1"
                      style={{ fontSize: 11.5, fontWeight: 600, background: "#ECFDF5", borderColor: "#BBF7D0", color: "#047857" }}>
                      <CheckCircle2 className="h-3 w-3" />
                      Active
                    </span>
                    {/* Joined */}
                    <span style={{ fontSize: 12, color: "#94A3B8" }}>
                      {new Date(member.joinedAt).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}

              {/* Session-user fallback row when API returned no members */}
              {members.length === 0 && sessionUser && (
                <div
                  className="grid items-center px-[18px] transition-colors hover:bg-slate-50"
                  style={{ gridTemplateColumns: "minmax(0,2fr) 1fr 1fr 100px", minHeight: 64 }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", fontSize: 13, fontWeight: 700, color: "#1D4ED8" }}>
                      {(sessionUser.displayName[0] ?? "U").toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: "#0F172A" }}>{sessionUser.displayName}</p>
                      <p className="truncate" style={{ fontSize: 11.5, color: "#94A3B8" }}>{sessionUser.email}</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1"
                    style={{ fontSize: 11.5, fontWeight: 600, background: "#EFF6FF", borderColor: "#BFDBFE", color: "#1D4ED8" }}>
                    <Crown className="h-3 w-3" />
                    Admin
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1"
                    style={{ fontSize: 11.5, fontWeight: 600, background: "#ECFDF5", borderColor: "#BBF7D0", color: "#047857" }}>
                    <CheckCircle2 className="h-3 w-3" />
                    Active
                  </span>
                  <span style={{ fontSize: 12, color: "#94A3B8" }}>—</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Pending invitations */}
        {invitations.length > 0 && (
          <Card className="animate-slide-up stagger-2">
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
              <CardDescription>{invitations.filter((i) => !i.acceptedAt && !i.revokedAt && new Date(i.expiresAt) > new Date()).length} pending</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invitations.map((inv) => {
                      const expired = !inv.acceptedAt && !inv.revokedAt && new Date(inv.expiresAt) <= new Date();
                      const accepted = !!inv.acceptedAt;
                      const revoked = !!inv.revokedAt;
                      const isPending = !accepted && !revoked && !expired;
                      return (
                        <TableRow key={inv.id}>
                          <TableCell className="text-sm font-medium">{inv.email}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize text-[10px]">{inv.role}</Badge>
                          </TableCell>
                          <TableCell>
                            {accepted && <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3 w-3" />Accepted</span>}
                            {revoked && <span className="flex items-center gap-1 text-xs text-muted-foreground"><XCircle className="h-3 w-3" />Revoked</span>}
                            {expired && <span className="flex items-center gap-1 text-xs text-amber-700"><Clock className="h-3 w-3" />Expired</span>}
                            {isPending && <span className="flex items-center gap-1 text-xs text-blue-700"><Clock className="h-3 w-3" />Pending</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(inv.expiresAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {isPending && (
                              <button
                                type="button"
                                onClick={() => void handleRevoke(inv.id)}
                                disabled={revokingId === inv.id}
                                className="rounded p-1 text-muted-foreground hover:text-red-600 disabled:opacity-40 transition-colors"
                                title="Revoke invitation"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
