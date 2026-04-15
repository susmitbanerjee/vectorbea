"use client";

import { useEffect, useState } from "react";
import { Crown, Eye, Mail, Plus, Shield, UserPlus } from "lucide-react";
import { toast } from "sonner";

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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("editor");
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setLoadingMembers(true);
    fetch(`/api/workspaces/${activeWorkspaceId}/members`)
      .then((r) => r.json())
      .then((data: Member[]) => { if (Array.isArray(data)) setMembers(data); })
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
      toast.error(`Seat limit reached (${seatsUsed}/${maxSeats}). Upgrade the plan to add more developers.`);
      return;
    }
    if (!normalizedEmail) {
      toast.error("Email is required.");
      return;
    }
    if (members.some((member) => member.email.toLowerCase() === normalizedEmail)) {
      toast.error("That user is already in this workspace.");
      return;
    }

    setInviting(true);
    await new Promise((resolve) => setTimeout(resolve, 800));

    const localPart = normalizedEmail.split("@")[0] ?? normalizedEmail;
    const displayName = localPart
      .split(/[._-]/)
      .filter(Boolean)
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join(" ");

    setMembers((current) => [
      {
        id: `${Date.now()}`,
        email: normalizedEmail,
        displayName: displayName || normalizedEmail,
        role: inviteRole,
        joinedAt: new Date().toISOString(),
      },
      ...current,
    ]);
    toast.success(`Invitation sent to ${normalizedEmail}`);
    setInviteEmail("");
    setInviteRole("editor");
    setInviteOpen(false);
    setInviting(false);
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
                          Upgrade Plan to add more developers
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

      <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {(["admin", "editor", "viewer"] as const).map((role) => {
            const cfg = ROLE_CONFIG[role];
            const Icon = cfg.icon;
            const count = members.filter((member) => member.role === role).length;
            return (
              <Card key={role} className="animate-slide-up">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">{count}</p>
                    <p className="text-xs text-muted-foreground">{cfg.label}s</p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="animate-slide-up stagger-1">
          <CardHeader>
            <CardTitle>Workspace members</CardTitle>
            <CardDescription>
              {members.length} member{members.length !== 1 ? "s" : ""} in{" "}
              {activeWorkspace?.name ?? "this workspace"}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">Seat usage</p>
                      <p className="text-xs text-muted-foreground">
                        {seatsUsed} of {maxSeats} seats are allocated across{" "}
                        {activeOrganization?.name ?? "this organization"}.
                      </p>
              </div>
              <Badge variant={seatLimitReached ? "destructive" : "outline"}>
                {seatsUsed}/{maxSeats}
              </Badge>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingMembers && members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">Loading members...</TableCell>
                    </TableRow>
                  ) : members.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-muted-foreground">No members found.</TableCell>
                    </TableRow>
                  ) : members.map((member) => {
                    const cfg = ROLE_CONFIG[member.role];
                    const Icon = cfg.icon;
                    return (
                      <TableRow key={member.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {member.avatarUrl ? (
                              <img src={member.avatarUrl} alt={member.displayName} className="h-8 w-8 rounded-full border border-border/60 object-cover" />
                            ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                                {member.displayName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                              </div>
                            )}
                            <span className="text-sm font-medium">{member.displayName}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {member.email}
                        </TableCell>
                        <TableCell>
                          <Badge variant={cfg.variant} className="gap-1">
                            <Icon className="h-3 w-3" />
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(member.joinedAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
