"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import type { Route } from "next";
import { cn } from "~/lib/cn";
import { TooltipProvider } from "~/components/ui/tooltip";
import { KeyboardProvider, useShortcut } from "~/lib/keyboard";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { ShortcutsSheet } from "./shortcuts-sheet";
import { EnvironmentRail } from "./environment";
import { WORKSPACES, INITIAL_COUNTS, type EnvironmentId, type ShellCounts } from "~/mocks/shell";
import { useWorkspace } from "@/lib/workspace-context";
import { apiFetch, withWorkspace } from "@/lib/api/client";

/* ══════════════════════════════════════════════════════════════════════════════
   THE APPLICATION SHELL

   Design §7.3: "Route changes reuse the shell — never re-animate the sidebar."

   That is a structural claim, not a CSS one. The shell is mounted ONCE by the
   route-group layout, above {children}. Next.js keeps a layout mounted across
   navigations within its segment, so the sidebar, topbar, palette and keyboard
   registry survive route changes with their React state intact — scroll
   position, collapsed state, an open menu. Only the content region swaps.

   Chrome therefore has NO entrance animation at all. The stagger belongs to
   content, and content owns it (see <StaggerContent>).
══════════════════════════════════════════════════════════════════════════════ */

const COLLAPSED_KEY = "vectorbea.shell.collapsed";
const ENV_KEY = "vectorbea.shell.environment";
const WORKSPACE_KEY = "vectorbea.shell.workspace";

export interface AppShellProps {
  children: React.ReactNode;
  user?: { name: string; email: string } | null;
}

export function AppShell({ children, user }: AppShellProps) {
  return (
    <KeyboardProvider>
      <TooltipProvider delayDuration={400} skipDelayDuration={200}>
        <ShellInner user={user}>{children}</ShellInner>
      </TooltipProvider>
    </KeyboardProvider>
  );
}

function ShellInner({ children, user }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    workspaces: contextWorkspaces,
    activeWorkspaceId,
    seatUsage,
    setActiveWorkspaceId,
  } = useWorkspace();
  const liveWorkspaces = React.useMemo(
    () => contextWorkspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      members: workspace.id === activeWorkspaceId ? seatUsage.used : 0,
      environment: "production" as const,
    })),
    [activeWorkspaceId, contextWorkspaces, seatUsage.used],
  );
  const shellWorkspaces = liveWorkspaces.length > 0 ? liveWorkspaces : WORKSPACES;
  const usingLiveWorkspaces = liveWorkspaces.length > 0;

  const [collapsed, setCollapsed] = React.useState(false);
  const [environment, setEnvironment] = React.useState<EnvironmentId>("production");
  const [fallbackWorkspaceId, setFallbackWorkspaceId] = React.useState(WORKSPACES[0].id);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [counts, setCounts] = React.useState<ShellCounts>(INITIAL_COUNTS);

  /* ── Persisted preferences ────────────────────────────────────────────────
     Read after mount so the server and first client render agree; writing on
     every change keeps the shell where the operator left it. */
  React.useEffect(() => {
    try {
      const c = window.localStorage.getItem(COLLAPSED_KEY);
      if (c !== null) setCollapsed(c === "true");
      const e = window.localStorage.getItem(ENV_KEY);
      if (e === "production" || e === "staging" || e === "development") setEnvironment(e);
      const w = window.localStorage.getItem(WORKSPACE_KEY);
      if (!usingLiveWorkspaces && w && WORKSPACES.some((x) => x.id === w)) setFallbackWorkspaceId(w);
    } catch {
      // Private mode or storage disabled — defaults are fine.
    }
  }, [usingLiveWorkspaces]);

  const persist = (key: string, value: string) => {
    try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
  };

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => { persist(COLLAPSED_KEY, String(!prev)); return !prev; });
  }, []);

  const changeEnvironment = React.useCallback((env: EnvironmentId) => {
    setEnvironment(env);
    persist(ENV_KEY, env);
  }, []);

  const changeWorkspace = React.useCallback((id: string) => {
    if (usingLiveWorkspaces) {
      setActiveWorkspaceId(id);
    } else {
      setFallbackWorkspaceId(id);
      persist(WORKSPACE_KEY, id);
    }
  }, [setActiveWorkspaceId, usingLiveWorkspaces]);

  /* ── Live badge counts ────────────────────────────────────────────────────
     Stand-in for the real subscription. The point of wiring it now is that the
     roll animation is exercised against CHANGING data — a counter that only
     ever renders its initial value hides every bug in the interpolation.

     The drift is a fixed ±1 cycle anchored to INITIAL_COUNTS, not a random
     walk. The walk wandered: the sidebar reached 7 approvals while Control,
     deriving from the same fixtures, showed 2. Two numbers describing one
     workspace disagreeing on screen costs more trust than a static badge ever
     would. This still moves, so the roll is still exercised, but it always
     comes back to the truth. */
  React.useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;

    type Summary = { pendingApprovals?: number };
    type Incident = { resolutionStatus?: string };
    type Connection = { status?: string };
    type ConnectionResponse = Connection[] | { items?: Connection[] };

    void Promise.allSettled([
      apiFetch<Summary>(withWorkspace("/api/dashboard/summary", activeWorkspaceId)),
      apiFetch<Incident[]>(withWorkspace("/api/failure-incidents", activeWorkspaceId)),
      apiFetch<ConnectionResponse>(withWorkspace("/api/connections", activeWorkspaceId)),
    ]).then(([summaryResult, incidentsResult, connectionsResult]) => {
      if (cancelled) return;
      const summary = summaryResult.status === "fulfilled" ? summaryResult.value : null;
      const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : [];
      const connectionResponse = connectionsResult.status === "fulfilled" ? connectionsResult.value : [];
      const connections = Array.isArray(connectionResponse) ? connectionResponse : (connectionResponse.items ?? []);

      setCounts({
        approvals: summary?.pendingApprovals ?? 0,
        incidents: incidents.filter((incident) => incident.resolutionStatus?.toLowerCase() !== "resolved").length,
        connections: connections.filter((connection) => {
          const status = connection.status?.toLowerCase();
          return status === "failed" || status === "failing" || status === "degraded";
        }).length,
      });
    });

    return () => { cancelled = true; };
  }, [activeWorkspaceId, pathname]);

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => { setDrawerOpen(false); }, [pathname]);

  const selectedWorkspaceId = usingLiveWorkspaces ? activeWorkspaceId : fallbackWorkspaceId;
  const workspace = shellWorkspaces.find((w) => w.id === selectedWorkspaceId) ?? shellWorkspaces[0] ?? WORKSPACES[0];

  /* ── Shortcuts ────────────────────────────────────────────────────────── */
  useShortcut({
    keys: "mod+k", group: "Global", label: "Open command palette", allowInInput: true,
    handler: () => setPaletteOpen((o) => !o),
  });
  useShortcut({
    keys: "/", group: "Global", label: "Search",
    handler: () => setPaletteOpen(true),
  });
  useShortcut({
    keys: "?", group: "Global", label: "Keyboard shortcuts",
    handler: () => setShortcutsOpen(true),
  });
  useShortcut({
    keys: "mod+\\", group: "Global", label: "Toggle sidebar", allowInInput: true,
    handler: toggleCollapsed,
  });
  useShortcut({
    keys: "escape", group: "Global", label: "Close topmost layer", allowInInput: true, hidden: true,
    handler: () => {
      // Radix closes its own layers; this covers the drawer, which is ours.
      if (drawerOpen) setDrawerOpen(false);
    },
  });

  const goto = React.useCallback((href: string) => router.push(href as Route), [router]);
  useShortcut({ keys: "g then c", group: "Navigate", label: "Go to Control", handler: () => goto("/control") });
  useShortcut({ keys: "g then r", group: "Navigate", label: "Go to Runs", handler: () => goto("/runs") });
  useShortcut({ keys: "g then w", group: "Navigate", label: "Go to Workflows", handler: () => goto("/workflows") });
  useShortcut({ keys: "g then a", group: "Navigate", label: "Go to Approvals", handler: () => goto("/approvals") });
  useShortcut({ keys: "g then i", group: "Navigate", label: "Go to Incidents", handler: () => goto("/incidents") });
  useShortcut({ keys: "g then t", group: "Navigate", label: "Go to Tools", handler: () => goto("/tools") });

  const sidebar = (
    <Sidebar
      collapsed={collapsed}
      onToggleCollapsed={toggleCollapsed}
      workspace={workspace}
      workspaces={shellWorkspaces}
      onWorkspaceChange={changeWorkspace}
      counts={counts}
      user={user}
      onOpenShortcuts={() => setShortcutsOpen(true)}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  return (
    <div className="bg-surface-app text-fg-primary font-ui flex h-dvh overflow-hidden">
      <EnvironmentRail environment={environment} />

      {/* Desktop sidebar. Below lg it is replaced by the drawer. */}
      <div className="hidden shrink-0 lg:block">{sidebar}</div>

      {/* Mobile drawer. */}
      <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="motion-fade z-overlay bg-surface-canvas/70 fixed inset-0 lg:hidden" />
          <Dialog.Content
            className={cn(
              "motion-drawer z-modal fixed inset-y-0 left-0 w-(--sidebar-expanded) lg:hidden",
            )}
          >
            <VisuallyHidden.Root>
              <Dialog.Title>Navigation</Dialog.Title>
            </VisuallyHidden.Root>
            {/* Force the expanded width inside the drawer regardless of the
                persisted desktop preference — a 56px drawer is pointless. */}
            <div className="h-full [&>nav]:w-full">
              <Sidebar
                collapsed={false}
                onToggleCollapsed={toggleCollapsed}
                workspace={workspace}
                workspaces={shellWorkspaces}
                onWorkspaceChange={changeWorkspace}
                counts={counts}
                user={user}
                onOpenShortcuts={() => setShortcutsOpen(true)}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          environment={environment}
          onEnvironmentChange={changeEnvironment}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSidebar={() => setDrawerOpen(true)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <StaggerContent key={pathname}>{children}</StaggerContent>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        environment={environment}
        onEnvironmentChange={changeEnvironment}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

/**
 * Content entrance — design §7.3.
 *
 * "Chrome is instant, then content staggers in at 40ms intervals over a max
 * 240ms window." Keyed on the pathname so it replays per route while the shell
 * around it does not.
 *
 * Implemented as a CSS animation on direct children rather than per-component
 * JS, so a screen gets the orchestration for free and cannot forget it. The
 * stagger caps at six children — beyond 240ms the page feels slow rather than
 * composed, which is exactly the failure the window exists to prevent.
 */
function StaggerContent({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "[&>*]:animate-[ink-content-in_var(--duration-base)_var(--ease-entrance)_both]",
        "[&>*:nth-child(1)]:[animation-delay:0ms]",
        "[&>*:nth-child(2)]:[animation-delay:40ms]",
        "[&>*:nth-child(3)]:[animation-delay:80ms]",
        "[&>*:nth-child(4)]:[animation-delay:120ms]",
        "[&>*:nth-child(5)]:[animation-delay:160ms]",
        "[&>*:nth-child(n+6)]:[animation-delay:200ms]",
      )}
    >
      {children}
    </div>
  );
}
