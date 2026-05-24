"use client";

import { Building2, Check, ChevronsUpDown, Layers3, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelLabel,
  DropdownMenuPanelSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useWorkspace, type WorkspaceView } from "@/lib/workspace-context";

const FREE_PLAN_TOOLTIP =
  "Free plans are limited to 1 Organization. Upgrade to Enterprise for unlimited orgs.";

export function WorkspaceSwitcher() {
  const router = useRouter();
  const {
    organizations,
    activeOrganization,
    activeWorkspace,
    canCreateOrganization,
    workspaces,
    setActiveWorkspaceId,
  } = useWorkspace();
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newOrganizationName, setNewOrganizationName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [creatingOrganization, setCreatingOrganization] = useState(false);

  const grouped = workspaces.reduce<Record<string, { orgName: string; items: WorkspaceView[] }>>(
    (acc, ws) => {
      if (!acc[ws.organizationId]) {
        acc[ws.organizationId] = { orgName: ws.organizationName, items: [] };
      }
      acc[ws.organizationId].items.push(ws);
      return acc;
    },
    {},
  );

  const createWorkspace = () => {
    if (!newWorkspaceName.trim() || creatingWorkspace) return;
    setCreatingWorkspace(true);
    startTransition(async () => {
      try {
        const body: Record<string, string> = { name: newWorkspaceName.trim() };
        if (activeWorkspace?.organizationId) {
          body.organizationId = activeWorkspace.organizationId;
        }

        const response = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Failed to create workspace");
        }

        const created = (await response.json()) as { id: string };
        setNewWorkspaceName("");
        setActiveWorkspaceId(created.id);
        toast.success("Workspace created.");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create workspace.");
      } finally {
        setCreatingWorkspace(false);
      }
    });
  };

  const createOrganization = () => {
    if (!newOrganizationName.trim() || creatingOrganization || !canCreateOrganization) return;
    setCreatingOrganization(true);
    startTransition(async () => {
      try {
        const response = await fetch("/api/organizations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newOrganizationName.trim() }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          id?: string;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to create organization");
        }

        setNewOrganizationName("");
        if (payload.id) {
          setActiveWorkspaceId(payload.id);
        }
        toast.success("Organization created.");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to create organization.",
        );
      } finally {
        setCreatingOrganization(false);
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-all"
          style={{
            background: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
              style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}
            >
              <Layers3 className="h-3.5 w-3.5" style={{ color: "#2563EB" }} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {activeWorkspace?.name ?? "Vectorbee Demo"}
              </p>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                {activeWorkspace?.organizationName ?? "Development"}
              </p>
            </div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 transition-colors" style={{ color: "var(--text-faint)" }} />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuPanel className="w-72" align="start">
        <DropdownMenuPanelLabel>Switch workspace</DropdownMenuPanelLabel>
        <DropdownMenuPanelSeparator />

        <div className="max-h-72 overflow-y-auto py-1">
          {Object.entries(grouped).length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No workspaces yet
            </p>
          ) : (
            Object.entries(grouped).map(([orgId, { orgName, items }]) => (
              <div key={orgId}>
                <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2.5">
                  <Building2 className="h-3 w-3 text-muted-foreground/60" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {orgName}
                  </span>
                </div>

                {items.map((ws) => {
                  const isActive = ws.id === activeWorkspace?.id;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => setActiveWorkspaceId(ws.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 pl-6 text-left text-sm transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-foreground hover:bg-accent/40",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold uppercase",
                            isActive
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border bg-muted text-muted-foreground",
                          )}
                        >
                          {ws.name.slice(0, 2)}
                        </div>
                        <span className="truncate">{ws.name}</span>
                      </div>
                      {isActive && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <DropdownMenuPanelSeparator />

        <div className="space-y-2 p-2">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Create new workspace
          </p>
          <Input
            value={newWorkspaceName}
            onChange={(event) => setNewWorkspaceName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                createWorkspace();
              }
            }}
            placeholder="acme-production"
            className="h-9 text-sm"
          />
          <Button
            className="h-8 w-full gap-1.5"
            size="sm"
            variant="outline"
            onClick={createWorkspace}
            disabled={creatingWorkspace || isPending || !newWorkspaceName.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
            {creatingWorkspace ? "Creating..." : "Create workspace"}
          </Button>
        </div>

        <DropdownMenuPanelSeparator />

        <div className="space-y-2 p-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Create new organization
            </p>
            <span className="text-[10px] text-muted-foreground">
              {organizations.length} org{organizations.length === 1 ? "" : "s"}
            </span>
          </div>
          <Input
            value={newOrganizationName}
            onChange={(event) => setNewOrganizationName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                createOrganization();
              }
            }}
            placeholder="Acme AI"
            className="h-9 text-sm"
          />
          <div title={!canCreateOrganization ? FREE_PLAN_TOOLTIP : undefined} className="space-y-2">
            <Button
              className="h-8 w-full gap-1.5"
              size="sm"
              variant="outline"
              onClick={createOrganization}
              disabled={
                creatingOrganization ||
                isPending ||
                !newOrganizationName.trim() ||
                !canCreateOrganization
              }
            >
              <Building2 className="h-3.5 w-3.5" />
              {creatingOrganization ? "Creating..." : "Create New Organization"}
            </Button>
            {!canCreateOrganization && activeOrganization?.planTier !== "enterprise" && (
              <p className="text-[11px] text-muted-foreground">{FREE_PLAN_TOOLTIP}</p>
            )}
          </div>
        </div>
      </DropdownMenuPanel>
    </DropdownMenu>
  );
}
