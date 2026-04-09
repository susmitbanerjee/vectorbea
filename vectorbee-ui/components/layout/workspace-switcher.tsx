"use client";

import type { Route } from "next";
import { Check, ChevronsUpDown, Layers3, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import type { OrganizationView } from "@/lib/api";
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

export function WorkspaceSwitcher({ organizations }: { organizations: OrganizationView[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [newOrgName, setNewOrgName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  // Default to the first available org if nothing is selected
  // (the (app) layout already redirects to /onboarding when there are zero orgs).
  const selectedOrgId = searchParams.get("org") ?? organizations[0]?.id ?? "";
  const active = organizations.find((item) => item.id === selectedOrgId) ?? organizations[0];

  const updateOrg = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("org", value);
    router.push(`${pathname}?${params}` as Route);
  };

  const createOrganization = () => {
    if (!newOrgName.trim() || creating) return;
    setCreating(true);
    startTransition(async () => {
      try {
        const response = await fetch("/api/organizations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newOrgName.trim() }),
        });
        if (response.ok) {
          const created = (await response.json()) as { id: string };
          setNewOrgName("");
          const params = new URLSearchParams(searchParams.toString());
          params.set("org", created.id);
          router.push(`${pathname}?${params}` as Route);
          router.refresh();
        }
      } finally {
        setCreating(false);
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-all hover:border-white/20 hover:bg-white/[0.05]"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-400/25 bg-amber-400/10">
              <Layers3 className="h-4 w-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{active?.name ?? "No workspace"}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {organizations.length} workspace{organizations.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-white" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuPanel className="w-72" align="start">
        <DropdownMenuPanelLabel>Switch workspace</DropdownMenuPanelLabel>
        <DropdownMenuPanelSeparator />

        <div className="max-h-64 overflow-y-auto py-1">
          {organizations.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No organizations yet
            </p>
          ) : (
            organizations.map((org) => {
              const isActive = org.id === selectedOrgId;
              return (
                <button
                  key={org.id}
                  type="button"
                  onClick={() => updateOrg(org.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                    isActive
                      ? "bg-amber-400/10 text-white"
                      : "text-slate-300 hover:bg-white/5 hover:text-white",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold uppercase",
                        isActive
                          ? "border-amber-400/40 bg-amber-400/15 text-amber-300"
                          : "border-white/10 bg-white/[0.04] text-slate-400",
                      )}
                    >
                      {org.name.slice(0, 2)}
                    </div>
                    <span className="truncate">{org.name}</span>
                  </div>
                  {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                </button>
              );
            })
          )}
        </div>

        <DropdownMenuPanelSeparator />

        <div className="space-y-2 p-2">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Create new workspace
          </p>
          <Input
            value={newOrgName}
            onChange={(event) => setNewOrgName(event.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                createOrganization();
              }
            }}
            placeholder="acme-production"
            className="h-9 border-white/10 bg-white/[0.04] text-sm text-white placeholder:text-slate-600"
          />
          <Button
            className="h-8 w-full gap-1.5 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25"
            size="sm"
            variant="outline"
            onClick={createOrganization}
            disabled={creating || isPending || !newOrgName.trim()}
          >
            <Plus className="h-3.5 w-3.5" />
            {creating ? "Creating…" : "Create workspace"}
          </Button>
        </div>
      </DropdownMenuPanel>
    </DropdownMenu>
  );
}
