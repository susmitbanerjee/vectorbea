"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Copy, Eye, EyeOff, Key, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { ApiKeyView, CreateApiKeyResponse, DeploymentAgentView } from "@/lib/api";
import { useRBAC, useWorkspace } from "@/lib/workspace-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  initialKeys: ApiKeyView[];
}

export function ApiKeysClient({ initialKeys }: Props) {
  const router = useRouter();
  const { activeWorkspace } = useWorkspace();
  const { hasAccess: canManageKeys } = useRBAC("admin");
  const [open, setOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<DeploymentAgentView[]>([]);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<CreateApiKeyResponse | null>(null);
  const [revealedRows, setRevealedRows] = useState<Record<string, boolean>>({});
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyView | null>(null);
  const [regenerateTarget, setRegenerateTarget] = useState<ApiKeyView | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const workspaceQuery = activeWorkspace?.id
    ? `?workspaceId=${encodeURIComponent(activeWorkspace.id)}`
    : "";

  useEffect(() => {
    if (!activeWorkspace?.id) return;
    fetch(`/api/agents?workspaceId=${encodeURIComponent(activeWorkspace.id)}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: DeploymentAgentView[]) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [activeWorkspace?.id]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  const createKey = async () => {
    if (!keyName.trim()) {
      toast.error("Give the key a name.");
      return;
    }

    setCreating(true);
    try {
      const response = await fetch(`/api/keys${workspaceQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyName: keyName.trim(), agentId: agentId || undefined }),
      });
      if (!response.ok) {
        const { error } = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(error || `Request failed (${response.status})`);
      }

      const created = (await response.json()) as CreateApiKeyResponse;
      setRevealed(created);
      setKeyName("");
      setAgentId("");
      setOpen(false);
      toast.success("API key created. Copy it now - it won't be shown again.");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create API key");
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string) => {
    setLoadingId(id);
    try {
      const response = await fetch(`/api/keys/${id}${workspaceQuery}`, {
        method: "DELETE",
      });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Request failed (${response.status})`);
      }
      toast.success("Key revoked");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setLoadingId(null);
      setRevokeTarget(null);
    }
  };

  const regenerateKey = async (oldKey: ApiKeyView) => {
    setLoadingId(oldKey.id);
    try {
      const createResponse = await fetch(`/api/keys${workspaceQuery}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyName: oldKey.name }),
      });
      if (!createResponse.ok) {
        const { error } = await createResponse.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(error || `Create failed (${createResponse.status})`);
      }
      const created = (await createResponse.json()) as CreateApiKeyResponse;

      const deleteResponse = await fetch(`/api/keys/${oldKey.id}${workspaceQuery}`, {
        method: "DELETE",
      });
      if (!deleteResponse.ok && deleteResponse.status !== 204) {
        throw new Error(`Delete failed (${deleteResponse.status})`);
      }

      setRevealed(created);
      toast.success("Key regenerated. Copy it now - it won't be shown again.");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate key");
    } finally {
      setLoadingId(null);
      setRegenerateTarget(null);
    }
  };

  const toggleRowReveal = (id: string) => {
    setRevealedRows((previous) => ({ ...previous, [id]: !previous[id] }));
  };

  return (
    <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
      <Dialog open={!!revokeTarget} onOpenChange={(openState) => { if (!openState) setRevokeTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API key</DialogTitle>
            <DialogDescription>
              Revoke <strong>{revokeTarget?.name}</strong>? Any services using it will lose access immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)} disabled={!!loadingId}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => revokeTarget && revokeKey(revokeTarget.id)}
              disabled={!!loadingId}
            >
              {loadingId === revokeTarget?.id ? "Revoking..." : "Revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!regenerateTarget}
        onOpenChange={(openState) => { if (!openState) setRegenerateTarget(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate API key</DialogTitle>
            <DialogDescription>
              Regenerate key for <strong>{regenerateTarget?.name}</strong>? The old key will stop working immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegenerateTarget(null)} disabled={!!loadingId}>
              Cancel
            </Button>
            <Button
              onClick={() => regenerateTarget && regenerateKey(regenerateTarget)}
              disabled={!!loadingId}
            >
              {loadingId === regenerateTarget?.id ? "Regenerating..." : "Regenerate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-end">
        {canManageKeys && (
          <Dialog open={open} onOpenChange={setOpen}>
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" />
              Create API Key
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>
                  Keys are shown once. Copy and store them in your secret manager before closing the dialog.
                </DialogDescription>
              </DialogHeader>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  createKey();
                }}
                className="mt-4 space-y-4"
              >
                {agents.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Agent (optional)
                    </label>
                    <Select
                      value={agentId}
                      onChange={(event) => {
                        const value = event.target.value;
                        setAgentId(value);
                        if (value) {
                          const agent = agents.find((item) => item.id === value);
                          if (agent) setKeyName(agent.name);
                        }
                      }}
                      className="h-10 bg-background"
                    >
                      <option value="">- Select an agent (optional) -</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Key name
                  </label>
                  <Input
                    value={keyName}
                    onChange={(event) => setKeyName(event.target.value)}
                    placeholder="production-agent"
                    autoFocus
                    className="h-10"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Use this name in your client config - fetch by name, no need to recreate keys.
                  </p>
                </div>
                {activeWorkspace && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Workspace
                    </label>
                    <div className="flex h-10 items-center rounded-lg border border-border bg-muted/30 px-3 text-sm text-foreground">
                      {activeWorkspace.name}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Key will be scoped to this workspace.
                    </p>
                  </div>
                )}
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
        )}
      </div>

      {revealed && (
        <Card className="animate-fade-in border-primary/40 bg-primary/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-primary" />
              <CardTitle>Your new API key</CardTitle>
            </div>
            <CardDescription>
              Copy this key now. For security, it won&apos;t be shown again after you dismiss this banner.
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
              : `${initialKeys.length} key${initialKeys.length !== 1 ? "s" : ""} in this workspace.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {initialKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
                <Key className="h-7 w-7 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-medium text-muted-foreground">No API keys yet</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Create a key to authenticate the VectorBea proxy and SDKs.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent / Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initialKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell className="text-sm font-medium">{key.name || "default"}</TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">
                          {revealedRows[key.id] ? key.maskedKey : "vb_••••••••"}
                        </code>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(key.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleRowReveal(key.id)}
                            title={revealedRows[key.id] ? "Hide key" : "Reveal key"}
                          >
                            {revealedRows[key.id]
                              ? <EyeOff className="h-4 w-4" />
                              : <Eye className="h-4 w-4" />}
                          </Button>
                          {canManageKeys && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRegenerateTarget(key)}
                                disabled={loadingId === key.id || isPending}
                                title="Regenerate key"
                              >
                                <RefreshCw className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRevokeTarget(key)}
                                disabled={loadingId === key.id || isPending}
                                className="text-muted-foreground hover:text-destructive"
                                title="Revoke key"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
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
