"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Key, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiKeyView, CreateApiKeyResponse, OrganizationView } from "@/lib/api";

interface Props {
  organizations: OrganizationView[];
  initialKeys: ApiKeyView[];
}

export function ApiKeysClient({ organizations, initialKeys }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<CreateApiKeyResponse | null>(null);
  const [isPending, startTransition] = useTransition();

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const createKey = async () => {
    if (!organizationId) {
      toast.error("Select an organization.");
      return;
    }
    if (!keyName.trim()) {
      toast.error("Give the key a name.");
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, name: keyName.trim() }),
      });
      if (!response.ok) {
        const { error } = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(error || `Request failed (${response.status})`);
      }
      const created = (await response.json()) as CreateApiKeyResponse;
      setRevealed(created);
      setKeyName("");
      setOpen(false);
      toast.success("API key created. Copy it now — it won't be shown again.");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      const response = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Request failed (${response.status})`);
      }
      toast.success("Key revoked");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    }
  };

  const orgName = (id: string) => organizations.find((o) => o.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={organizations.length === 0}>
              <Plus className="h-4 w-4" />
              Create API Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Keys are shown once. Copy and store them in your secret manager before closing the dialog.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createKey();
              }}
              className="mt-4 space-y-4"
            >
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Key name</label>
                <input
                  type="text"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="production-agent"
                  autoFocus
                  className="flex h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-slate-600 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="text-[11px] text-muted-foreground">
                  Use this name in your client config — fetch by name, no need to recreate keys.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Organization</label>
                <div className="relative">
                  <select
                    value={organizationId}
                    onChange={(e) => setOrganizationId(e.target.value)}
                    className="flex h-10 w-full appearance-none rounded-lg border border-white/10 bg-white/5 px-3 pr-9 text-sm text-white focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/20 [&>option]:bg-popover [&>option]:text-foreground"
                  >
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                  <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={creating}>
                  Cancel
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating ? "Creating..." : "Create key"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {revealed && (
        <Card className="border-primary/40 bg-primary/5 animate-fade-in">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-primary" />
              <CardTitle>Your new API key</CardTitle>
            </div>
            <CardDescription>
              Copy this key now. For security, it won't be shown again after you dismiss this banner.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <code className="flex-1 overflow-x-auto rounded-lg bg-background px-3 py-2 font-mono text-sm">
              {revealed.apiKey}
            </code>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => copy(revealed.apiKey)}>
                <Copy className="h-4 w-4" />
                Copy
              </Button>
              <Button variant="ghost" onClick={() => setRevealed(null)}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="animate-slide-up">
        <CardHeader>
          <CardTitle>Workspace keys</CardTitle>
          <CardDescription>
            {initialKeys.length === 0
              ? "No keys issued yet."
              : `${initialKeys.length} key${initialKeys.length !== 1 ? "s" : ""} across your workspaces.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {initialKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 mb-4">
                <Key className="h-7 w-7 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No API keys yet</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Create a key to authenticate the VectorBee proxy and SDKs.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initialKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="text-sm font-medium">{key.name || "default"}</TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">{key.maskedKey}</code>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <Badge variant="outline">{orgName(key.organizationId)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(key.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => revoke(key.id)}
                          disabled={isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
