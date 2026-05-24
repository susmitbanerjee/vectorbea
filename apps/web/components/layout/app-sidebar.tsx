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
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import type { DashboardSummary } from "@/lib/api";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { cn } from "@/lib/utils";
import { useRBAC, useWorkspace } from "@/lib/workspace-context";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLLAPSED_KEY = "vectorbee.sidebarCollapsed";
const SIDEBAR_W_EXPANDED = 264;
const SIDEBAR_W_COLLAPSED = 64;

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

type NavGroup = {
  label: string;
  items: NavItem[];
};

// Grouped nav — 3 sections
const NAV_GROUPS: NavGroup[] = [
  {
    label: "PROJECT",
    items: [
      { href: "/dashboard" as never,   label: "Overview",   icon: LayoutDashboard },
      { href: "/workflows" as never,   label: "Workflows",  icon: GitBranch },
      { href: "/runs" as never,        label: "Runs",       icon: List },
      { href: "/approvals" as never,   label: "Approvals",  icon: CheckCircle2 },
    ],
  },
  {
    label: "BUILD",
    items: [
      { href: "/agents" as never,      label: "Agents",     icon: Bot },
      { href: "/tools" as never,       label: "Tools",      icon: Wrench },
      { href: "/connections" as never, label: "Connections",icon: Plug },
    ],
  },
  {
    label: "OPERATE",
    items: [
      { href: "/schedules" as never,   label: "Schedules",  icon: CalendarClock },
      { href: "/workers" as never,     label: "Workers",    icon: Server },
      { href: "/settings" as never,    label: "Settings",   icon: Settings2 },
    ],
  },
];

// All nav items flat (for active detection)
const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

// Settings sub-nav
const SETTINGS_SUB_NAV: NavItem[] = [
  { href: "/settings/members" as never, label: "Members",  icon: Users,      isSubItem: true, subItemGroup: isSettingsRoute },
  { href: "/settings/billing" as never, label: "Billing",  icon: CreditCard, isSubItem: true, subItemGroup: isSettingsRoute },
  { href: "/settings/usage" as never,   label: "Usage",    icon: BarChart3,  isSubItem: true, subItemGroup: isSettingsRoute },
  { href: "/api-keys" as never,         label: "API Keys", icon: KeyRound,   isSubItem: true, subItemGroup: isSettingsRoute, minRole: "admin" },
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

  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (isBuilderRoute(pathname)) {
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

  function isActive(item: NavItem): boolean {
    return (
      pathname === item.href ||
      (pathname.startsWith(`${item.href}/`) &&
        !ALL_NAV_ITEMS.some(other =>
          other.href !== item.href &&
          (pathname === other.href || pathname.startsWith(`${other.href}/`)) &&
          other.href.length > item.href.length,
        ))
    );
  }

  function navLink(item: NavItem, allItems: NavItem[]) {
    if (item.isSubItem) {
      if (collapsed) return null;
      const sg = item.subItemGroup;
      const visible = typeof sg === "function" ? sg(pathname)
        : typeof sg === "string" ? pathname.startsWith(sg) : false;
      if (!visible) return null;
    }

    const Icon = item.icon;
    const fullHref = `${item.href}${currentQuery ? `?${currentQuery}` : ""}`;
    const active = isActive(item);
    const loading = isPending && pendingHref === fullHref;

    if (collapsed) {
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
            "group relative flex w-full items-center justify-center rounded-lg transition-all duration-150",
            active ? "nav-active" : "hover:bg-[#ECEFF3]",
            loading && "opacity-60",
          )}
          style={{ height: 38 }}
        >
          <Icon
            className={cn(
              "h-[16px] w-[16px] shrink-0 transition-colors",
              active ? "text-[#2563EB]" : "text-[#6B7280] group-hover:text-[#374151]",
            )}
          />
          {loading && (
            <Loader2 className="absolute h-[13px] w-[13px] animate-spin text-[#2563EB]" />
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
          "group relative flex w-full items-center gap-[10px] rounded-lg text-left transition-all duration-150",
          item.isSubItem
            ? "pl-7 pr-3 py-1.5"
            : "px-[10px]",
          active
            ? "nav-active"
            : "text-[#4B5563] hover:bg-[#ECEFF3] hover:text-[#111827]",
          loading && "opacity-60",
        )}
        style={item.isSubItem ? { fontSize: 13 } : { height: 38, fontSize: 14 }}
      >
        <Icon
          className={cn(
            "shrink-0 transition-colors",
            item.isSubItem ? "h-[13px] w-[13px]" : "h-[16px] w-[16px]",
            active ? "text-[#2563EB]" : "text-[#6B7280] group-hover:text-[#374151]",
            loading && "opacity-0",
          )}
        />
        {loading && (
          <Loader2 className={cn(
            "absolute h-[13px] w-[13px] animate-spin text-[#2563EB]",
            item.isSubItem ? "left-7" : "left-[10px]",
          )} />
        )}
        <span className="flex-1 truncate" style={{ fontWeight: active ? 700 : item.isSubItem ? 500 : 520 }}>
          {item.label}
        </span>
        {item.badge && (
          <span className="rounded px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest bg-blue-50 text-blue-600 border border-blue-200">
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
        backgroundColor: "#F4F5F7",
        borderRight: "1px solid #DDE3EA",
        transition: "width 200ms cubic-bezier(0.4,0,0.2,1)",
      }}
    >
      {/* ── Logo / header ─────────────────────────────────────────────────── */}
      <div className={cn("pt-3 pb-2.5", collapsed ? "px-[14px]" : "px-[14px]")}>
        {collapsed ? (
          <div className="flex items-center justify-center" style={{ height: 44 }}>
            <Link href="/dashboard" className="flex items-center justify-center">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#111827]">
                <Logo className="h-3.5 w-3.5 text-white" />
              </div>
            </Link>
          </div>
        ) : (
          <>
            {/* Logo row */}
            <div className="mb-3 flex items-center justify-between" style={{ height: 44 }}>
              <Link href="/dashboard" className="flex items-center gap-2.5">
                <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[#111827]">
                  <Logo className="h-3.5 w-3.5 text-white" />
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "#111827" }}>
                  Vectorbee
                </span>
              </Link>
              <span
                className="rounded-full border px-1.5 py-0.5"
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  color: "#2563EB",
                  borderColor: "#BFDBFE",
                  background: "#EFF6FF",
                }}
              >
                Dev
              </span>
            </div>
            <WorkspaceSwitcher />
          </>
        )}
      </div>

      {/* ── Grouped nav ──────────────────────────────────────────────────── */}
      <nav className={cn("flex-1 overflow-y-auto pb-2", collapsed ? "px-[13px]" : "px-[14px]")}>
        {collapsed ? (
          // Collapsed: all items as icons, no labels or groups
          <div className="space-y-0.5">
            {NAV_GROUPS.flatMap(g => g.items).map(item => navLink(item, ALL_NAV_ITEMS))}
            <div className="my-2 border-t border-[#DDE3EA]" />
            {filterByRole(SETTINGS_SUB_NAV.filter(i => !i.isSubItem)).map(item => navLink(item, SETTINGS_SUB_NAV))}
          </div>
        ) : (
          // Expanded: grouped with section labels
          <>
            {NAV_GROUPS.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? "mt-0.5" : ""}>
                <span className="nav-section-label">{group.label}</span>
                <div className="space-y-0.5">
                  {filterByRole(group.items).map(item => navLink(item, ALL_NAV_ITEMS))}
                  {/* Settings sub-items appear inline under Settings */}
                  {group.label === "OPERATE" && filterByRole(SETTINGS_SUB_NAV).map(item => navLink(item, SETTINGS_SUB_NAV))}
                </div>
              </div>
            ))}
          </>
        )}
      </nav>

      {/* ── Bottom: worker status + collapse + user ────────────────────── */}
      <div
        className={cn("pb-3 pt-2", collapsed ? "px-[13px]" : "px-[14px]")}
        style={{ borderTop: "1px solid #DDE3EA" }}
      >
        {/* Collapse toggle */}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mb-2.5 flex w-full items-center rounded-lg px-2 py-1.5 text-[#6B7280] transition-colors hover:bg-[#ECEFF3] hover:text-[#374151]",
            collapsed ? "justify-center" : "gap-2",
          )}
        >
          {collapsed
            ? <PanelLeftOpen className="h-[15px] w-[15px]" />
            : <><PanelLeftClose className="h-[15px] w-[15px] shrink-0" /><span style={{ fontSize: 13, fontWeight: 500 }}>Collapse menu</span></>
          }
        </button>

        {!collapsed && (
          <>
            {/* Worker status card */}
            <div
              className="mb-2.5 flex items-center gap-2.5 rounded-[10px] px-3 py-2.5"
              style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", minHeight: 52 }}
            >
              <span className={cn(
                "h-2 w-2 rounded-full shrink-0",
                isConnected ? "bg-emerald-500" : "bg-red-400",
              )} />
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 13, fontWeight: 650, color: "#111827", lineHeight: 1.2 }} className="truncate">
                  {isConnected
                    ? `${connectedWorkers} worker${connectedWorkers === 1 ? "" : "s"} active`
                    : "No workers connected"}
                </p>
                <p className="mt-0.5 truncate" style={{ fontSize: 12, color: "#6B7280" }}>
                  {isConnected ? "Scheduler active" : "Start a worker to run jobs"}
                </p>
              </div>
            </div>

            {/* User row */}
            {user && (
              <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[#ECEFF3]">
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt={user.full_name ?? user.email ?? "User"}
                    width={24}
                    height={24}
                    className="h-6 w-6 shrink-0 rounded-full border border-border object-cover"
                  />
                ) : (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#111827] text-[11px] font-semibold text-white">
                    {((user.full_name ?? user.email ?? "?")[0] ?? "?").toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate leading-none" style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                    {user.full_name ?? user.email?.split("@")[0] ?? "User"}
                  </p>
                  {user.email && (
                    <p className="mt-0.5 truncate" style={{ fontSize: 11, color: "#9CA3AF" }}>
                      {user.email}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void fetch("/api/auth/session", { method: "DELETE" }).then(() => window.location.assign("/login"))}
                  title="Sign out"
                  className="shrink-0 rounded p-1 text-[#9CA3AF] transition-colors hover:text-[#374151]"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </>
        )}

        {collapsed && (
          <div className="flex justify-center mt-1">
            <span
              className={cn("h-2 w-2 rounded-full", isConnected ? "bg-emerald-500" : "bg-red-400")}
              title={isConnected ? `${connectedWorkers} worker(s) active` : "No workers connected"}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
