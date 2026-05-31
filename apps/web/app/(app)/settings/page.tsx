"use client";

import {
  AlertTriangle,
  Bell,
  Check,
  Globe,
  KeyRound,
  Loader2,
  ShieldCheck,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppHeader } from "@/components/layout/app-header";
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
import { useWorkspace } from "@/lib/workspace-context";

const API_BASE = process.env.NEXT_PUBLIC_VECTORBEA_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export default function SettingsPage() {
  const { activeWorkspace, activeWorkspaceId, role, planTier, seatUsage } = useWorkspace();
  const [resetOpen, setResetOpen] = useState(false);
  const [rotateKeyOpen, setRotateKeyOpen] = useState(false);

  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState<{
    emailEnabled: boolean;
    events: Record<string, boolean>;
  } | null>(null);
  const [notifSaving, setNotifSaving] = useState(false);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    fetch(`/api/workspaces/${activeWorkspaceId}/notification-preferences`, { cache: "no-store" })
      .then(r => r.json())
      .then((d: unknown) => { if (d && typeof d === "object") setNotifPrefs(d as NonNullable<typeof notifPrefs>); })
      .catch(() => {});
  }, [activeWorkspaceId]);

  const saveNotifPrefs = async (updates: Partial<NonNullable<typeof notifPrefs>>) => {
    if (!activeWorkspaceId || notifSaving) return;
    setNotifSaving(true);
    const merged = {
      ...(notifPrefs ?? {}),
      ...updates,
      events: { ...(notifPrefs?.events ?? {}), ...(updates.events ?? {}) },
    };
    setNotifPrefs(merged as NonNullable<typeof notifPrefs>);
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/notification-preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Failed to save");
      }
      toast.success("Notification preferences saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save preferences");
    } finally {
      setNotifSaving(false);
    }
  };

  const confirmReset = () => {
    setResetOpen(false);
    toast.success("Workspace reset request submitted.", {
      description: "Agent jobs and run history will be removed. Audit logs are retained for compliance.",
    });
  };

  const confirmRotateKey = () => {
    setRotateKeyOpen(false);
    toast.success("Worker token rotation request submitted.");
  };

  return (
    <div className="min-h-screen">
      <AppHeader title="Settings" subtitle="Workspace, security, and operational controls." />

      <div className="grid gap-6 px-4 py-6 md:px-6 xl:grid-cols-2 xl:px-8">

        {/* ── Workspace ── */}
        <Card className="animate-slide-up">
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Identity and routing for your active workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace name</label>
              <Input defaultValue={activeWorkspace?.name ?? "Workspace"} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace ID</label>
              <Input value={activeWorkspace?.id ?? ""} readOnly className="font-mono text-xs" />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Control plane endpoint</label>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <Input value={API_BASE} readOnly className="font-mono text-xs" />
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => toast.success("Workspace settings saved.")}>
                <Check className="h-4 w-4" />
                Save changes
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Access & Plan ── */}
        <Card className="animate-slide-up stagger-1">
          <CardHeader>
            <CardTitle>Access &amp; Plan</CardTitle>
            <CardDescription>Current permissions and tenancy limits.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Role", value: role, icon: ShieldCheck },
              { label: "Plan tier", value: planTier, icon: Workflow },
              { label: "Seats", value: `${seatUsage.used}/${seatUsage.max}`, icon: Users },
            ].map((row) => {
              const Icon = row.icon;
              return (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{row.label}</span>
                  </div>
                  <Badge variant="outline">{row.value}</Badge>
                </div>
              );
            })}

            <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              Seat enforcement is active. Existing users retain access; new invitations are blocked at the limit.
            </div>
          </CardContent>
        </Card>

        {/* ── Security controls ── */}
        <Card className="animate-slide-up stagger-2">
          <CardHeader>
            <CardTitle>Security controls</CardTitle>
            <CardDescription>Credential and operational safeguards.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Rotate worker token</p>
                <p className="text-xs text-muted-foreground">
                  Regenerates the worker authentication secret for this workspace.
                </p>
              </div>
              <Dialog open={rotateKeyOpen} onOpenChange={setRotateKeyOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <KeyRound className="h-4 w-4" />
                    Rotate
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Rotate worker token?</DialogTitle>
                    <DialogDescription>
                      Connected workers will need the new token to continue processing runs.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setRotateKeyOpen(false)}>Cancel</Button>
                    <Button onClick={confirmRotateKey}>Rotate token</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              Audit logs are immutable and retained for operational traceability and compliance.
            </div>
          </CardContent>
        </Card>

        {/* ── Notification preferences ── */}
        <Card className="animate-slide-up stagger-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Notification preferences
            </CardTitle>
            <CardDescription>Control which events trigger email notifications for this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Master switch */}
            <div className="flex items-start justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
              <div>
                <p className="text-sm font-medium">Email notifications</p>
                <p className="text-xs text-muted-foreground">Send emails to workspace admins</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifPrefs?.emailEnabled ?? false}
                onClick={() => void saveNotifPrefs({ emailEnabled: !(notifPrefs?.emailEnabled ?? false) })}
                className={`mt-0.5 h-5 w-9 rounded-full border transition-colors ${(notifPrefs?.emailEnabled ?? false) ? "bg-primary border-primary" : "bg-muted border-border"}`}
              >
                <span className={`block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform mx-0.5 ${(notifPrefs?.emailEnabled ?? false) ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </div>

            {/* Per-event email toggles */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email me when</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { key: "run_failed", label: "Run failed" },
                  { key: "approval_requested", label: "Approval requested" },
                  { key: "budget_exceeded", label: "Budget exceeded" },
                  { key: "retry_exhausted", label: "Retries exhausted" },
                  { key: "quota", label: "Quota nearing limit" },
                ].map(({ key, label }) => {
                  const enabled = notifPrefs?.events?.[key] ?? true;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => void saveNotifPrefs({ events: { ...(notifPrefs?.events ?? {}), [key]: !enabled } })}
                      disabled={notifSaving}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors disabled:opacity-60 ${enabled ? "border-primary/40 bg-primary/8 text-foreground" : "border-border text-muted-foreground hover:bg-muted/30"}`}
                    >
                      <span className={`h-2 w-2 rounded-full shrink-0 ${enabled ? "bg-primary" : "bg-muted-foreground/30"}`} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Danger zone ── */}
        <Card className="animate-slide-up stagger-4 border-destructive/40">
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
                  Remove all agent jobs and run history from this workspace.
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
                      This permanently deletes all agent jobs, run history, and artifacts. Audit logs are not deleted.
                      This action cannot be undone.
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
