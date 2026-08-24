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
import { WorkspaceGate } from "./workspace-gate";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { ShortcutsSheet } from "./shortcuts-sheet";
import { EnvironmentRail } from "./environment";
import { type EnvironmentId, type ShellCounts, type Workspace } from "~/mocks/shell";
import { useWorkspace } from "~/lib/workspace/workspace-provider";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { queryKeys } from "~/lib/api/keys";

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
  user?: { name: string; email: string; avatarUrl?: string | null } | null;
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

  const [collapsed, setCollapsed] = React.useState(false);
  const [environment, setEnvironment] = React.useState<EnvironmentId>("production");
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const { workspaces: realWorkspaces, workspaceId, setWorkspace } = useWorkspace();
  const api = useApi();

  /* ── Persisted preferences ────────────────────────────────────────────────
     Read after mount so the server and first client render agree; writing on
     every change keeps the shell where the operator left it. */
  React.useEffect(() => {
    try {
      const c = window.localStorage.getItem(COLLAPSED_KEY);
      if (c !== null) setCollapsed(c === "true");
      const e = window.localStorage.getItem(ENV_KEY);
      if (e === "production" || e === "staging" || e === "development") setEnvironment(e);
    } catch {
      // Private mode or storage disabled — defaults are fine.
    }
  }, []);

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
    setWorkspace(id);
    persist(WORKSPACE_KEY, id);
  }, [setWorkspace]);

  /* ── Live badge counts ────────────────────────────────────────────────────
     These used to drift on a fixed fake cycle anchored to fixture data — the
     sidebar could say 7 approvals while Control, deriving from the real API,
     said 2. Two numbers describing one workspace disagreeing on screen costs
     more trust than a static badge ever would, so counts now come from the
     same workspace-scoped queries Control uses: pending approvals, unresolved
     incidents, and connections currently failing their health check. */
  const scope = React.useMemo(() => ({ workspaceId, environmentId: null }), [workspaceId]);
  const countsEnabled = Boolean(workspaceId);
  const approvalsQuery = useApiQuery({
    queryKey: queryKeys.approvals.list(scope, { status: "PENDING" }),
    queryFn: () => api.approvals.list({ ...scope, status: "PENDING" }),
    enabled: countsEnabled,
  });
  const incidentsQuery = useApiQuery({
    queryKey: [...queryKeys.env(workspaceId, null), "incidents"],
    queryFn: () => api.incidents.list({ ...scope, limit: 100 }),
    enabled: countsEnabled,
  });
  const connectionsQuery = useApiQuery({
    queryKey: queryKeys.connections.list(scope),
    queryFn: () => api.connections.list({ ...scope, pageSize: 100 }),
    enabled: countsEnabled,
  });
  const counts: ShellCounts = React.useMemo(
    () => ({
      approvals: approvalsQuery.data?.items.length ?? 0,
      incidents: (incidentsQuery.data ?? []).filter((i) => i.resolutionStatus !== "resolved").length,
      connections: (connectionsQuery.data?.items ?? []).filter((c) => c.lastTestStatus === "failed").length,
    }),
    [approvalsQuery.data, incidentsQuery.data, connectionsQuery.data],
  );

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => { setDrawerOpen(false); }, [pathname]);

  /**
   * The real workspace, from the provider that resolved it against the API.
   *
   * The placeholder exists for the window before resolution completes and for
   * the case where /api/bootstrap could not identify one. It is deliberately
   * unnamed rather than a plausible-looking company: a made-up name here is
   * indistinguishable from a real one, which is the whole problem.
   */
  const workspaceList: Workspace[] = realWorkspaces.map((w) => ({
    id: w.id,
    name: w.name,
    // Carried through as undefined when unknown rather than defaulted to 0 —
    // the switcher omits the line instead of asserting an empty workspace.
    members: w.members,
    // The switcher separates owned from shared on this.
    role: w.role,
    environment: environment,
  }));
  const workspace: Workspace =
    workspaceList.find((w) => w.id === workspaceId) ??
    workspaceList[0] ?? { id: "", name: "No workspace", environment };

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
      workspaces={workspaceList}
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
                workspaces={workspaceList}
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
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSidebar={() => setDrawerOpen(true)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <StaggerContent key={pathname}>
            {/* One answer to "is there a workspace?", above every route — see
                WorkspaceGate. Without it each screen renders its own skeleton
                forever, because a scoped query with no workspace never runs. */}
            <WorkspaceGate>{children}</WorkspaceGate>
          </StaggerContent>
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
