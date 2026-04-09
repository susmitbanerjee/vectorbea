"use client";

import { useTheme } from "next-themes";
import { AlertTriangle, Check, Globe, Moon, Package, Sun, Trash2 } from "lucide-react";
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

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [resetOpen, setResetOpen] = useState(false);

  const confirmReset = () => {
    setResetOpen(false);
    toast.success("Reset request sent to administrator.", {
      description: "No destructive action was performed — this is a guarded placeholder.",
    });
  };

  return (
    <div className="min-h-screen">
      <AppHeader title="Settings" subtitle="Workspace defaults, appearance, and environment information." />

      <div className="grid gap-6 px-4 py-6 md:px-6 xl:px-8 xl:grid-cols-2">
        <Card className="animate-slide-up">
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>Identity and routing for this VectorBee install.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace name</label>
              <Input defaultValue="VectorBee Local" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">API endpoint</label>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <Input value={API_BASE} readOnly className="font-mono text-xs" />
              </div>
              <p className="text-xs text-muted-foreground">
                Configure via <code className="font-mono">NEXT_PUBLIC_API_URL</code>.
              </p>
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
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Choose how the dashboard looks on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {[
                { id: "light", label: "Light", icon: Sun },
                { id: "dark", label: "Dark", icon: Moon },
                { id: "system", label: "System", icon: Globe },
              ].map((opt) => {
                const Icon = opt.icon;
                const active = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setTheme(opt.id)}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border hover:bg-accent/50 text-muted-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="animate-slide-up stagger-2">
          <CardHeader>
            <CardTitle>Environment</CardTitle>
            <CardDescription>Versions and runtime info.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "UI", value: "Next.js 15 / React 19" },
              { label: "Backend", value: "Kotlin / JVM 21" },
              { label: "Database", value: "PostgreSQL" },
              { label: "Build", value: process.env.NODE_ENV ?? "development" },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{row.label}</span>
                </div>
                <Badge variant="outline">{row.value}</Badge>
              </div>
            ))}
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
                  Remove all prompts, versions, and audit logs from this workspace.
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
                      This will permanently delete all prompts, versions, and audit logs. This action cannot be undone.
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
