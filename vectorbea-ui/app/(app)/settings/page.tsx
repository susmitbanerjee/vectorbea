"use client";

import {
  AlertTriangle,
  Check,
  Globe,
  KeyRound,
  ShieldCheck,
  Trash2,
  Users,
  Workflow,
} from "lucide-react";
import { useState } from "react";
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export default function SettingsPage() {
  const { activeWorkspace, role, planTier, seatUsage } = useWorkspace();
  const [resetOpen, setResetOpen] = useState(false);
  const [rotateKeyOpen, setRotateKeyOpen] = useState(false);

  const confirmReset = () => {
    setResetOpen(false);
    toast.success("Workspace reset request submitted.", {
      description: "Prompts and versions will be removed. Audit logs are retained for compliance.",
    });
  };

  const confirmRotateKey = () => {
    setRotateKeyOpen(false);
    toast.success("Sidecar token rotation request submitted.");
  };

  return (
    <div className="min-h-screen">
      <AppHeader title="Settings" subtitle="Workspace governance, security, and operational controls." />

      <div className="grid gap-6 px-4 py-6 md:px-6 xl:grid-cols-2 xl:px-8">
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

        <Card className="animate-slide-up stagger-1">
          <CardHeader>
            <CardTitle>Access & Plan</CardTitle>
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
              Seat enforcement is active. Existing users retain access, new invitations are blocked at limit.
            </div>
          </CardContent>
        </Card>

        <Card className="animate-slide-up stagger-2">
          <CardHeader>
            <CardTitle>Security controls</CardTitle>
            <CardDescription>Credential and operational safeguards.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Rotate sidecar token</p>
                <p className="text-xs text-muted-foreground">
                  Regenerates deployment credentials for this workspace.
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
                    <DialogTitle>Rotate sidecar token?</DialogTitle>
                    <DialogDescription>
                      Existing running sidecars will need the new token after rotation.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setRotateKeyOpen(false)}>
                      Cancel
                    </Button>
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

        <Card className="animate-slide-up stagger-3 border-destructive/40">
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
                  Remove all prompts and prompt versions from this workspace.
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
                      This permanently deletes prompts and versions. Audit logs are not deleted.
                      This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="mt-4 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setResetOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="destructive" onClick={confirmReset}>
                      Yes, reset
                    </Button>
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
