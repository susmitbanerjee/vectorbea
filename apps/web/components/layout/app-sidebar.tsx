"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  Bot,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  List,
  Loader2,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Server,
  Settings2,
  Wrench,
  Users,
  Zap,
} from "lucide-react";


import { Logo } from "@/components/ui/Logo";
import type { DashboardSummary } from "@/lib/api";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { cn } from "@/lib/utils";
import { useRBAC, useWorkspace } from "@/lib/workspace-context";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLLAPSED_KEY = "vectorbee.sidebarCollapsed";
const SIDEBAR_W_EXPANDED = 264;
const SIDEBAR_W_COLLAPSED = 56;

// ─── Route helpers ────────────────────────────────────────────────────────────

function isSettingsRoute(p: string) {
  return p === "/settings" || p.startsWith("/settings/") ||
    p === "/api-keys" || p.startsWith("/api-keys/");
}

function isBuilderRoute(p: string) {
  return /\/workflows\/[^/]+\/builder/.test(p);
}

// ─── Nav definition ───────────────────────────────────────────────────────────

type NavItem = {
  href: Route;
  label: string;
  icon: React.ElementType;
  minRole?: "admin" | "editor";
  isSubItem?: boolean;
  subItemGroup?: string | ((p: string) => boolean);
  badge?: string;
};

// Primary nav — 10 product surfaces
const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard" as never,     label: "Overview",     icon: LayoutDashboard },
  { href: "/workflows" as never,     label: "Workflows",    icon: GitBranch },
  { href: "/agents" as never,        label: "Agents",       icon: Bot },
  { href: "/tools" as never,         label: "Tools",        icon: Wrench },
  { href: "/connections" as never,   label: "Connections",  icon: Plug },
  { href: "/runs" as never,          label: "Runs",         icon: List },
  { href: "/approvals",              label: "Approvals",    icon: CheckCircle2 },
  { href: "/schedules" as never,     label: "Schedules",    icon: CalendarClock },
  { href: "/workers" as never,       label: "Workers",      icon: Server },
];

// Settings sub-nav — Connections removed; lives in PRIMARY_NAV
const SETTINGS_NAV: NavItem[] = [
  { href: "/settings",            label: "Settings",  icon: Settings2 },
  { href: "/settings/members",    label: "Members",   icon: Users,      isSubItem: true, subItemGroup: isSettingsRoute },
  { href: "/settings/billing",    label: "Billing",   icon: CreditCard, isSubItem: true, subItemGroup: isSettingsRoute },
  { href: "/settings/usage",      label: "Usage",     icon: BarChart3,  isSubItem: true, subItemGroup: isSettingsRoute },
  { href: "/api-keys",            label: "API Keys",  icon: KeyRound,   isSubItem: true, subItemGroup: isSettingsRoute, minRole: "admin" },
];

type SidebarUser = {
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
} | null;

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export function AppSidebar({ summary, user }: { summary: DashboardSummary | null; user?: SidebarUser }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [workspaceSummary, setWorkspaceSummary] = useState<DashboardSummary | null>(summary);
  const { isAdmin, isEditor } = useRBAC();
  const { activeWorkspaceId } = useWorkspace();

  // ── Collapse state ──────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState(false);

  // Initialize from localStorage; auto-collapse in builder
  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (isBuilderRoute(pathname)) {
      // Builder always collapses sidebar to give canvas max space
      setCollapsed(true);
    } else {
      setCollapsed(stored === "true");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(COLLAPSED_KEY, String(next));
      return next;
    });
  }

  const filterByRole = useMemo(() => (items: NavItem[]) =>
    items.filter(item => {
      if (!item.minRole) return true;
      if (item.minRole === "admin") return isAdmin;
      if (item.minRole === "editor") return isEditor || isAdmin;
      return true;
    }), [isAdmin, isEditor]);

  useEffect(() => { setPendingHref(null); }, [pathname]);

  useEffect(() => {
    if (!activeWorkspaceId) { setWorkspaceSummary(summary); return; }
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/dashboard/summary?workspaceId=${encodeURIComponent(activeWorkspaceId!)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed");
        const data = (await res.json()) as DashboardSummary;
        if (!cancelled) setWorkspaceSummary(data);
      } catch {
        if (!cancelled) setWorkspaceSummary(null);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeWorkspaceId, summary]);

  function navLink(item: NavItem, allItems: NavItem[]) {
    if (item.isSubItem) {
      if (collapsed) return null; // hide sub-items when collapsed
      const sg = item.subItemGroup;
      const visible = typeof sg === "function" ? sg(pathname)
        : typeof sg === "string" ? pathname.startsWith(sg) : false;
      if (!visible) return null;
    }

    const Icon = item.icon;
    const fullHref = `${item.href}${currentQuery ? `?${currentQuery}` : ""}`;
    const active =
      pathname === item.href ||
      (pathname.startsWith(`${item.href}/`) &&
        !allItems.some(other =>
          other.href !== item.href &&
          (pathname === other.href || pathname.startsWith(`${other.href}/`)) &&
          other.href.length > item.href.length,
        ));
    const loading = isPending && pendingHref === fullHref;

    if (collapsed) {
      // Icon-only mode
      return (
        <Link
          key={item.href}
          href={fullHref as Route}
          title={item.label}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            if (pathname === item.href || pendingHref === fullHref) return;
            setPendingHref(fullHref);
            startTransition(() => {});
          }}
          className={cn(
            "group relative flex w-full items-center justify-center rounded-md transition-all duration-150",
            "h-9",
            active
              ? "nav-active"
              : "hover:bg-sidebar-hover",
            loading && "opacity-60",
          )}
        >
          <Icon
            className={cn(
              "h-[16px] w-[16px] shrink-0 transition-colors",
              active ? "text-[#38BDF8]" : "text-sidebar-muted/70 group-hover:text-sidebar-fg",
            )}
          />
          {loading && (
            <Loader2 className="absolute h-[13px] w-[13px] animate-spin text-[#38BDF8]" />
          )}
        </Link>
      );
    }

    return (
      <Link
        key={item.href}
        href={fullHref as Route}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          if (pathname === item.href || pendingHref === fullHref) return;
          setPendingHref(fullHref);
          startTransition(() => {});
        }}
        className={cn(
          "group relative flex w-full items-center gap-2.5 rounded-md text-left transition-all duration-150",
          item.isSubItem ? "pl-8 pr-3 py-1.5 text-[12px]" : "px-2.5 py-[7px] text-[13px]",
          active
            ? "nav-active font-semibold text-sidebar-fg"
            : "font-normal text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-fg",
          loading && "opacity-60",
        )}
      >
        {/* Active accent line rendered via ::before in CSS (.nav-active) */}
        <Icon
          className={cn(
            "shrink-0 transition-colors",
            item.isSubItem ? "h-[13px] w-[13px]" : "h-[15px] w-[15px]",
            active ? "text-[#38BDF8]" : "text-sidebar-muted/70 group-hover:text-sidebar-fg",
            loading && "opacity-0",
          )}
        />
        {loading && (
          <Loader2 className={cn(
            "absolute h-[13px] w-[13px] animate-spin text-[#38BDF8]",
            item.isSubItem ? "left-8" : "left-2.5",
          )} />
        )}
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge && (
          <span className="rounded px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest bg-[#38BDF8]/10 text-[#38BDF8]">
            {item.badge}
          </span>
        )}
      </Link>
    );
  }

  const connectedWorkers = workspaceSummary?.activeAgents ?? 0;
  const isConnected = connectedWorkers > 0;
  const sidebarW = collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W_EXPANDED;

  return (
    <aside
      className="sidebar-scroll hidden h-full shrink-0 overflow-y-auto lg:flex lg:flex-col"
      style={{
        width: sidebarW,
        backgroundColor: "var(--bg-sidebar)",
        borderRight: "1px solid rgba(148,163,184,0.08)",
        transition: "width 200ms cubic-bezier(0.4,0,0.2,1)",
      }}
    >
      {/* ── Logo / header ─────────────────────────────────────────────────── */}
      <div className={cn("pt-5 pb-4", collapsed ? "px-2" : "px-4")}>
        {collapsed ? (
          /* Collapsed: just the logo icon */
          <div className="flex flex-col items-center gap-3">
            <Link href="/dashboard" className="flex items-center justify-center">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.2)" }}
              >
                <Logo className="h-3.5 w-3.5" />
              </div>
            </Link>
          </div>
        ) : (
          /* Expanded: logo + workspace switcher */
          <>
            <div className="mb-4 flex items-center justify-between px-0.5">
              <Link href="/dashboard" className="flex items-center gap-2.5">
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.2)" }}
                >
                  <Logo className="h-3.5 w-3.5" />
                </div>
                <span className="text-[14px] font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
                  Vectorbee
                </span>
              </Link>
              {/* Environment chip */}
              <span
                className="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest"
                style={{ background: "rgba(56,189,248,0.1)", color: "#38BDF8", border: "1px solid rgba(56,189,248,0.15)" }}
              >
                Dev
              </span>
            </div>
            {/* Workspace card */}
            <WorkspaceSwitcher />
          </>
        )}
      </div>

      {/* ── Primary nav ──────────────────────────────────────────────────── */}
      <nav className={cn("flex-1 overflow-y-auto pb-2", collapsed ? "px-1.5" : "px-3")}>
        <div className="space-y-0.5">
          {filterByRole(PRIMARY_NAV).map(item => navLink(item, PRIMARY_NAV))}
        </div>

        {/* Settings group */}
        {!collapsed && (
          <div className="mt-4 space-y-0.5">
            {filterByRole(SETTINGS_NAV).map(item => navLink(item, SETTINGS_NAV))}
          </div>
        )}
        {collapsed && (
          <div className="mt-4 space-y-0.5">
            {filterByRole(SETTINGS_NAV.filter(i => !i.isSubItem)).map(item => navLink(item, SETTINGS_NAV))}
          </div>
        )}
      </nav>

      {/* ── Bottom: collapse toggle + worker status + user ─────────────── */}
      <div className={cn("pb-4 pt-2", collapsed ? "px-1.5" : "px-3")} style={{ borderTop: "1px solid rgba(148,163,184,0.08)" }}>

        {/* Collapse / expand toggle */}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mb-3 flex w-full items-center rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-hover",
            collapsed ? "justify-center" : "gap-2",
          )}
          style={{ color: "var(--text-faint)" }}
        >
          {collapsed
            ? <PanelLeftOpen className="h-4 w-4" />
            : <><PanelLeftClose className="h-4 w-4 shrink-0" /><span className="text-[12px]">Collapse</span></>
          }
        </button>

        {!collapsed && (
          <>
            {/* Worker health pill */}
            <div
              className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2.5"
              style={{ background: "var(--surface-2)", border: "1px solid rgba(148,163,184,0.1)" }}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", isConnected ? "live-dot" : "bg-red-500")} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {isConnected ? `${connectedWorkers} worker${connectedWorkers === 1 ? "" : "s"} connected` : "No workers"}
                </p>
                <p className="text-[10px] truncate" style={{ color: "var(--text-faint)" }}>
                  {isConnected ? "Scheduler active" : "Start a worker process"}
                </p>
              </div>
              <Zap className="h-3 w-3 shrink-0" style={{ color: isConnected ? "#10B981" : "var(--text-faint)" }} />
            </div>

            {/* User row */}
            {user && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-hover">
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt={user.full_name ?? user.email ?? "User"}
                    width={26}
                    height={26}
                    className="h-[26px] w-[26px] shrink-0 rounded-full object-cover"
                    style={{ border: "1px solid rgba(148,163,184,0.15)" }}
                  />
                ) : (
                  <div
                    className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                    style={{ background: "rgba(56,189,248,0.12)", color: "#38BDF8", border: "1px solid rgba(56,189,248,0.2)" }}
                  >
                    {((user.full_name ?? user.email ?? "?")[0] ?? "?").toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium leading-none" style={{ color: "var(--text-primary)" }}>
                    {user.full_name ?? user.email?.split("@")[0] ?? "User"}
                  </p>
                  {user.email && (
                    <p className="mt-0.5 truncate text-[10px]" style={{ color: "var(--text-faint)" }}>
                      {user.email}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void fetch("/api/auth/session", { method: "DELETE" }).then(() => window.location.assign("/login"))}
                  title="Sign out"
                  className="shrink-0 rounded p-1 transition-colors hover:text-foreground"
                  style={{ color: "var(--text-faint)" }}
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Version */}
            <p className="mt-2 px-2 text-[10px] font-mono" style={{ color: "var(--text-faint)" }}>
              MVP Preview · v0.9.4
            </p>
          </>
        )}

        {/* Collapsed: just the worker dot */}
        {collapsed && (
          <div className="flex justify-center mt-1">
            <span
              className={cn("h-2 w-2 rounded-full", isConnected ? "live-dot" : "bg-red-500")}
              title={isConnected ? `${connectedWorkers} worker(s) connected` : "No workers connected"}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
