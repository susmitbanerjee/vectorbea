"use client";

import {
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  Globe,
  KeyRound,
  Loader2,
  MessageSquare,
  Plus,
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
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { ProviderConfig } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export default function SettingsPage() {
  const { activeWorkspace, activeWorkspaceId, role, planTier, seatUsage } = useWorkspace();
  const [resetOpen, setResetOpen] = useState(false);
  const [rotateKeyOpen, setRotateKeyOpen] = useState(false);

  // Slack integration state
  const [slackConfig, setSlackConfig] = useState<{
    configured: boolean; enabled: boolean;
    events: Record<string, boolean>; webhookMasked: string | null;
  } | null>(null);
  const [slackWebhookInput, setSlackWebhookInput] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackTesting, setSlackTesting] = useState(false);

  // Notification preferences state
  const [notifPrefs, setNotifPrefs] = useState<{
    emailEnabled: boolean; slackEnabled: boolean;
    events: Record<string, boolean>; slackEvents: Record<string, boolean>;
  } | null>(null);
  const [notifSaving, setNotifSaving] = useState(false);

  // Provider configs state
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [providerForm, setProviderForm] = useState({ providerType: "openai", displayName: "", defaultModel: "", baseUrl: "", apiKey: "" });
  const [savingProvider, setSavingProvider] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    // Slack integration
    fetch(`/api/settings/integrations/slack?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then(r => r.json())
      .then((d: unknown) => { if (d && typeof d === "object") setSlackConfig(d as typeof slackConfig extends null ? never : NonNullable<typeof slackConfig>); })
      .catch(() => {});
    // Notification preferences
    fetch(`/api/workspaces/${activeWorkspaceId}/notification-preferences`, { cache: "no-store" })
      .then(r => r.json())
      .then((d: unknown) => { if (d && typeof d === "object") setNotifPrefs(d as NonNullable<typeof notifPrefs>); })
      .catch(() => {});
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setProvidersLoading(true);
    fetch(`/api/settings/providers?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
      .then(r => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setProviders(data as ProviderConfig[]); })
      .catch(() => {/* providers table may not exist yet */})
      .finally(() => setProvidersLoading(false));
  }, [activeWorkspaceId]);

  const addProvider = async () => {
    if (!activeWorkspaceId || savingProvider) return;
    if (!providerForm.apiKey.trim()) { setProviderError("API key is required."); return; }
    setSavingProvider(true); setProviderError(null);
    try {
      const res = await fetch(`/api/settings/providers?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerType: providerForm.providerType,
          displayName: providerForm.displayName.trim() || providerForm.providerType,
          defaultModel: providerForm.defaultModel.trim() || undefined,
          baseUrl: providerForm.baseUrl.trim() || undefined,
          apiKey: providerForm.apiKey.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to add provider");
      setProviders(prev => [json as ProviderConfig, ...prev]);
      setProviderForm({ providerType: "openai", displayName: "", defaultModel: "", baseUrl: "", apiKey: "" });
      setShowProviderForm(false);
      toast.success("Provider config added.");
    } catch (e) {
      setProviderError(e instanceof Error ? e.message : "Failed to add provider");
    } finally {
      setSavingProvider(false);
    }
  };

  const toggleProvider = async (id: string, enabled: boolean) => {
    if (!activeWorkspaceId) return;
    try {
      const res = await fetch(`/api/settings/providers/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update");
      setProviders(prev => prev.map(p => p.id === id ? json as ProviderConfig : p));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update provider");
    }
  };

  const deleteProvider = async (id: string) => {
    if (!activeWorkspaceId) return;
    try {
      const res = await fetch(`/api/settings/providers/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? "Failed to delete"); }
      setProviders(prev => prev.filter(p => p.id !== id));
      toast.success("Provider config removed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete provider");
    }
  };

  const saveSlack = async (updates: { webhookUrl?: string; enabled?: boolean; events?: Record<string, boolean> }) => {
    if (!activeWorkspaceId || slackSaving) return;
    setSlackSaving(true);
    try {
      const res = await fetch(`/api/settings/integrations/slack?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates),
      });
      const j = await res.json() as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "Failed to save");
      // Refresh config
      const refresh = await fetch(`/api/settings/integrations/slack?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
      const refreshed = await refresh.json() as NonNullable<typeof slackConfig>;
      setSlackConfig(refreshed);
      setSlackWebhookInput("");
      toast.success("Slack settings saved.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to save Slack settings"); }
    finally { setSlackSaving(false); }
  };

  const testSlack = async () => {
    if (!activeWorkspaceId || slackTesting) return;
    setSlackTesting(true);
    try {
      const body = slackWebhookInput ? { webhookUrl: slackWebhookInput } : {};
      const res = await fetch(`/api/settings/integrations/slack/test?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) throw new Error(j.error ?? "Test failed");
      toast.success("Test notification sent to Slack!");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Slack test failed"); }
    finally { setSlackTesting(false); }
  };

  const saveNotifPrefs = async (updates: Partial<NonNullable<typeof notifPrefs>>) => {
    if (!activeWorkspaceId || notifSaving) return;
    setNotifSaving(true);
    const merged = { ...(notifPrefs ?? {}), ...updates, events: { ...(notifPrefs?.events ?? {}), ...(updates.events ?? {}) }, slackEvents: { ...(notifPrefs?.slackEvents ?? {}), ...(updates.slackEvents ?? {}) } };
    setNotifPrefs(merged as NonNullable<typeof notifPrefs>);
    try {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/notification-preferences`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates),
      });
      if (!res.ok) { const j = await res.json() as { error?: string }; throw new Error(j.error ?? "Failed to save"); }
      toast.success("Notification preferences saved.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed to save preferences"); }
    finally { setNotifSaving(false); }
  };

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

        <Card className="animate-slide-up stagger-3 xl:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Provider configs</CardTitle>
                <CardDescription>Manage AI provider API keys for this workspace.</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowProviderForm(v => !v)} className="gap-2">
                <Plus className="h-4 w-4" />{showProviderForm ? "Cancel" : "Add provider"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {providerError && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">{providerError}</p>}
            {showProviderForm && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Provider type</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex h-9 w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40"
                        >
                          <span className="truncate">
                            {{ openai: "OpenAI", anthropic: "Anthropic", google: "Google", enterprise_gateway: "Enterprise gateway" }[providerForm.providerType] ?? providerForm.providerType}
                          </span>
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
                        <DropdownMenuRadioGroup value={providerForm.providerType} onValueChange={(v) => setProviderForm(f => ({ ...f, providerType: v }))}>
                          <DropdownMenuPanelRadioItem value="openai">OpenAI</DropdownMenuPanelRadioItem>
                          <DropdownMenuPanelRadioItem value="anthropic">Anthropic</DropdownMenuPanelRadioItem>
                          <DropdownMenuPanelRadioItem value="google">Google</DropdownMenuPanelRadioItem>
                          <DropdownMenuPanelRadioItem value="enterprise_gateway">Enterprise gateway</DropdownMenuPanelRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuPanel>
                    </DropdownMenu>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Display name</label>
                    <Input placeholder="Optional" value={providerForm.displayName} onChange={e => setProviderForm(f => ({ ...f, displayName: e.target.value }))} className="text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Default model</label>
                    <Input placeholder="e.g. gpt-4.1" value={providerForm.defaultModel} onChange={e => setProviderForm(f => ({ ...f, defaultModel: e.target.value }))} className="text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Base URL (optional)</label>
                    <Input placeholder="https://…" value={providerForm.baseUrl} onChange={e => setProviderForm(f => ({ ...f, baseUrl: e.target.value }))} className="text-sm" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">API key *</label>
                    <Input type="password" placeholder="sk-…" value={providerForm.apiKey} onChange={e => setProviderForm(f => ({ ...f, apiKey: e.target.value }))} className="text-sm font-mono" />
                  </div>
                </div>
                <Button size="sm" onClick={() => void addProvider()} disabled={savingProvider} className="gap-2">
                  {savingProvider ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add provider
                </Button>
              </div>
            )}
            {providersLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading providers…</div>
            ) : providers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No provider configs yet. Add one above.</div>
            ) : (
              providers.map(p => (
                <div key={p.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{p.displayName}</span>
                      <Badge variant="outline" className="text-[10px]">{p.providerType}</Badge>
                      <Badge variant={p.enabled ? "success" : "secondary"} className="text-[10px]">{p.enabled ? "enabled" : "disabled"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{p.maskedKey}{p.defaultModel ? ` · ${p.defaultModel}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => void toggleProvider(p.id, !p.enabled)}>
                      {p.enabled ? "Disable" : "Enable"}
                    </Button>
                    <button type="button" onClick={() => void deleteProvider(p.id)} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
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

        {/* ── Slack Integration ── */}
        <Card className="animate-slide-up xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              Slack integration
            </CardTitle>
            <CardDescription>Receive alerts, evaluation results, and rollout events in Slack.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Status */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${slackConfig?.configured && slackConfig?.enabled ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
                <span>{slackConfig?.configured ? (slackConfig.enabled ? "Connected and active" : "Configured but disabled") : "Not configured"}</span>
                {slackConfig?.webhookMasked && (
                  <span className="font-mono text-[10px] text-muted-foreground">{slackConfig.webhookMasked}</span>
                )}
              </div>
              {slackConfig?.configured && (
                <button
                  type="button"
                  onClick={() => void saveSlack({ enabled: !slackConfig.enabled })}
                  className={`text-xs font-medium ${slackConfig.enabled ? "text-amber-400 hover:text-amber-300" : "text-emerald-400 hover:text-emerald-300"}`}
                >
                  {slackConfig.enabled ? "Disable" : "Enable"}
                </button>
              )}
            </div>

            {/* Webhook input */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {slackConfig?.configured ? "Update webhook URL" : "Slack webhook URL"}
              </label>
              <div className="flex gap-2">
                <Input
                  type="url"
                  value={slackWebhookInput}
                  onChange={(e) => setSlackWebhookInput(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="font-mono text-xs flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!slackWebhookInput.startsWith("https://hooks.slack.com/") || slackSaving}
                  onClick={() => void saveSlack({ webhookUrl: slackWebhookInput, enabled: true })}
                >
                  {slackSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={(!slackConfig?.configured && !slackWebhookInput) || slackTesting}
                  onClick={() => void testSlack()}
                >
                  {slackTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Test"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Create an <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener" className="text-primary hover:underline">Incoming Webhook</a> in your Slack workspace. The URL is encrypted and never shown again after saving.
              </p>
            </div>

            {/* Event toggles */}
            {slackConfig?.configured && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notify on</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    { key: "alerts", label: "Alerts triggered" },
                    { key: "regressions", label: "Regression failures" },
                    { key: "evaluations", label: "Evaluation complete" },
                    { key: "rollout", label: "Rollout events" },
                    { key: "quota", label: "Quota warnings" },
                  ].map(({ key, label }) => {
                    const enabled = slackConfig.events?.[key] ?? false;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => void saveSlack({ events: { ...(slackConfig.events ?? {}), [key]: !enabled } })}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium text-left transition-colors ${enabled ? "border-primary/40 bg-primary/8 text-foreground" : "border-border text-muted-foreground hover:bg-muted/30"}`}
                      >
                        <span className={`h-2 w-2 rounded-full shrink-0 ${enabled ? "bg-primary" : "bg-muted-foreground/30"}`} />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Notification Preferences ── */}
        <Card className="animate-slide-up xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Notification preferences
            </CardTitle>
            <CardDescription>Control which events trigger email or Slack notifications for this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Master switches */}
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { key: "emailEnabled", label: "Email notifications", desc: "Send emails to workspace admins" },
                { key: "slackEnabled", label: "Slack notifications", desc: "Post to configured Slack channel" },
              ].map(({ key, label, desc }) => {
                const val = notifPrefs?.[key as keyof typeof notifPrefs] as boolean ?? false;
                return (
                  <div key={key} className="flex items-start justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={val}
                      onClick={() => void saveNotifPrefs({ [key]: !val })}
                      className={`mt-0.5 h-5 w-9 rounded-full border transition-colors ${val ? "bg-primary border-primary" : "bg-muted border-border"}`}
                    >
                      <span className={`block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform mx-0.5 ${val ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Per-event email toggles */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email me when</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { key: "alerts", label: "Alert triggered" },
                  { key: "regressions", label: "Regression failed" },
                  { key: "evaluations", label: "Evaluation complete" },
                  { key: "rollout", label: "Rollout blocked / promoted" },
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

      </div>
    </div>
  );
}
