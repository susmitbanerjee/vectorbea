"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart2,
  BookOpen,
  Bot,
  CalendarClock,
  CheckCircle2,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  List,
  Loader2,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings2,
  Wrench,
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import type { DashboardSummary } from "@/lib/api";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { cn } from "@/lib/utils";
import { useRBAC, useWorkspace } from "@/lib/workspace-context";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLLAPSED_KEY = "vectorbee.sidebarCollapsed";
const SIDEBAR_W_EXPANDED = 260;
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
  /** Live count key resolved against the workspace summary. */
  countKey?: "pendingApprovals";
  /** Open in a new tab (e.g. standalone docs). */
  newTab?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

// Grouped nav — 3 sections
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Project",
    items: [
      { href: "/dashboard" as never,   label: "Overview",   icon: LayoutDashboard },
      { href: "/workflows" as never,   label: "Workflows",  icon: GitBranch },
      { href: "/runs" as never,        label: "Runs",       icon: List },
      { href: "/approvals" as never,   label: "Approvals",  icon: CheckCircle2, countKey: "pendingApprovals" },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/agents" as never,      label: "Agents",     icon: Bot },
      { href: "/tools" as never,       label: "Tools",      icon: Wrench },
      { href: "/connections" as never, label: "Connections",icon: Plug },
    ],
  },
  {
    label: "Operate",
    items: [
      { href: "/schedules" as never, label: "Schedules", icon: CalendarClock },
      { href: "/settings" as never,  label: "Settings",  icon: Settings2 },
    ],
  },
];

// All nav items flat (for active detection)
const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);

// Settings sub-nav
const SETTINGS_SUB_NAV: NavItem[] = [
  { href: "/settings/usage" as never, label: "Usage & Limits", icon: BarChart2, isSubItem: true, subItemGroup: isSettingsRoute },
  { href: "/api-keys" as never, label: "API Keys", icon: KeyRound, isSubItem: true, subItemGroup: isSettingsRoute, minRole: "admin" },
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
    // Exact match always wins
    if (pathname === item.href) return true;
    // Sub-items: exact match only (already handled above)
    if (item.isSubItem) return false;
    // Parent items: active only if no sub-item in SETTINGS_SUB_NAV is active for this path
    const subItemActive = SETTINGS_SUB_NAV.some(sub => pathname === sub.href || pathname.startsWith(`${sub.href}/`));
    if (subItemActive) return false;
    return (
      pathname.startsWith(`${item.href}/`) &&
      !ALL_NAV_ITEMS.some(other =>
        other.href !== item.href &&
        (pathname === other.href || pathname.startsWith(`${other.href}/`)) &&
        other.href.length > item.href.length,
      )
    );
  }

  function liveCount(item: NavItem): number {
    if (item.countKey === "pendingApprovals") return workspaceSummary?.pendingApprovals ?? 0;
    return 0;
  }

  function navLink(item: NavItem) {
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
    const count = liveCount(item);

    if (collapsed) {
      return (
        <Link
          key={item.href}
          href={fullHref as Route}
          title={count > 0 ? `${item.label} (${count})` : item.label}
          aria-current={active ? "page" : undefined}
          {...(item.newTab ? { target: "_blank", rel: "noopener" } : {})}
          onClick={() => {
            if (item.newTab) return;
            if (pathname === item.href || pendingHref === fullHref) return;
            setPendingHref(fullHref);
            startTransition(() => {});
          }}
          className={cn(
            "group relative flex w-full items-center justify-center rounded-[8px] transition-colors duration-150",
            active ? "bg-[#E6F4EF]" : "hover:bg-[#F3F4F5]",
            loading && "opacity-60",
          )}
          style={{ height: 36 }}
        >
          <Icon
            className={cn(
              "h-[16px] w-[16px] shrink-0 transition-colors",
              active ? "text-[#007F4E]" : "text-[#6B7280] group-hover:text-[#0B0D0F]",
            )}
            strokeWidth={1.9}
          />
          {count > 0 && (
            <span className="absolute right-1 top-1 flex h-[7px] w-[7px] rounded-full bg-[#CA8A04]" />
          )}
          {loading && (
            <Loader2 className="absolute h-[13px] w-[13px] animate-spin text-[#006B45]" />
          )}
        </Link>
      );
    }

    return (
      <Link
        key={item.href}
        href={fullHref as Route}
        aria-current={active ? "page" : undefined}
        {...(item.newTab ? { target: "_blank", rel: "noopener" } : {})}
        onClick={() => {
          if (item.newTab) return;
          if (pathname === item.href || pendingHref === fullHref) return;
          setPendingHref(fullHref);
          startTransition(() => {});
        }}
        className={cn(
          "group relative flex w-full items-center gap-[10px] rounded-[8px] text-left transition-colors duration-150",
          item.isSubItem ? "py-[7px] pl-8 pr-2.5" : "px-2.5",
          active
            ? "bg-[#E6F4EF] text-[#006B45]"
            : "text-[#4B5563] hover:bg-[#F3F4F5] hover:text-[#0B0D0F]",
          loading && "opacity-60",
        )}
        style={item.isSubItem ? { fontSize: 12.5 } : { height: 35, fontSize: 13.5 }}
      >
        {/* Active rail indicator */}
        {active && !item.isSubItem && (
          <span className="absolute left-0 top-1/2 h-[16px] w-[3px] -translate-y-1/2 rounded-r-full bg-[#007F4E]" />
        )}
        <Icon
          className={cn(
            "shrink-0 transition-colors",
            item.isSubItem ? "h-[13px] w-[13px]" : "h-[15.5px] w-[15.5px]",
            active ? "text-[#007F4E]" : "text-[#9CA3AF] group-hover:text-[#4B5563]",
            loading && "opacity-0",
          )}
          strokeWidth={1.9}
        />
        {loading && (
          <Loader2 className={cn(
            "absolute h-[13px] w-[13px] animate-spin text-[#006B45]",
            item.isSubItem ? "left-8" : "left-2.5",
          )} />
        )}
        <span className="flex-1 truncate" style={{ fontWeight: active ? 650 : 500 }}>
          {item.label}
        </span>
        {count > 0 && (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-1 font-mono text-[10px] font-semibold tabular-nums text-[#92400E]">
            {count}
          </span>
        )}
        {item.badge && (
          <span className="rounded border border-[#9CCFBB] bg-[#E6F4EF] px-1 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-[#006B45]">
            {item.badge}
          </span>
        )}
      </Link>
    );
  }

  const sidebarW = collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W_EXPANDED;

  return (
    <aside
      className="sidebar-scroll hidden h-full shrink-0 overflow-y-auto lg:flex lg:flex-col"
      style={{
        width: sidebarW,
        backgroundColor: "#FFFFFF",
        borderRight: "1px solid #E0E3E6",
        transition: "width 200ms cubic-bezier(0.4,0,0.2,1)",
      }}
    >
      {/* ── Logo / header ─────────────────────────────────────────────────── */}
      <div className="px-3.5 pb-2.5 pt-3">
        {collapsed ? (
          <div className="flex items-center justify-center" style={{ height: 44 }}>
            <Link href="/dashboard" className="flex items-center justify-center">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#0B0D0F]">
                <Logo className="h-3.5 w-3.5 text-white" />
              </div>
            </Link>
          </div>
        ) : (
          <>
            {/* Logo row */}
            <div className="mb-3 flex items-center justify-between" style={{ height: 44 }}>
              <Link href="/dashboard" className="flex items-center gap-2.5">
                <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] bg-[#0B0D0F]">
                  <Logo className="h-3.5 w-3.5 text-white" />
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B0D0F" }}>
                  Vectorbea
                </span>
              </Link>
              <span className="rounded-full border border-[#9CCFBB] bg-[#E6F4EF] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-[#006B45]">
                Dev
              </span>
            </div>
            <WorkspaceSwitcher />
          </>
        )}
      </div>

      {/* ── Grouped nav ──────────────────────────────────────────────────── */}
      <nav className={cn("flex-1 overflow-y-auto pb-2", collapsed ? "px-[13px]" : "px-3.5")}>
        {collapsed ? (
          // Collapsed: all items as icons, no labels or groups
          <div className="space-y-0.5">
            {NAV_GROUPS.flatMap(g => g.items).map(item => navLink(item))}
            <div className="my-2 border-t border-[#ECEEEF]" />
            {filterByRole(SETTINGS_SUB_NAV.filter(i => !i.isSubItem)).map(item => navLink(item))}
          </div>
        ) : (
          // Expanded: grouped with mono section labels
          <>
            {NAV_GROUPS.map((group, gi) => (
              <div key={group.label}>
                <span
                  className="block select-none px-2.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-[#9CA3AF]"
                  style={{ marginTop: gi === 0 ? 6 : 18, marginBottom: 4 }}
                >
                  {group.label}
                </span>
                <div className="space-y-px">
                  {filterByRole(group.items).map(item => navLink(item))}
                  {/* Settings sub-items appear inline under Settings */}
                  {group.label === "Operate" && filterByRole(SETTINGS_SUB_NAV).map(item => navLink(item))}
                </div>
              </div>
            ))}
          </>
        )}
      </nav>

      {/* ── Bottom: docs + collapse + user ───────────────────────────────── */}
      <div
        className={cn("pb-3 pt-2", collapsed ? "px-[13px]" : "px-3.5")}
        style={{ borderTop: "1px solid #ECEEEF" }}
      >
        {/* Docs — separate from nav (opens a new tab) */}
        <a
          href="/docs"
          target="_blank"
          rel="noopener"
          title="Documentation (opens in a new tab)"
          className={cn(
            "mb-1 flex w-full items-center rounded-[8px] px-2.5 py-1.5 text-[#4B5563] transition-colors hover:bg-[#F3F4F5] hover:text-[#0B0D0F]",
            collapsed ? "justify-center" : "gap-2",
          )}
        >
          <BookOpen className="h-[15px] w-[15px] shrink-0 text-[#9CA3AF]" strokeWidth={1.9} />
          {!collapsed && (
            <>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>Docs</span>
              <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.08em] text-[#C9CED4]">↗</span>
            </>
          )}
        </a>

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mb-2 flex w-full items-center rounded-[8px] px-2.5 py-1.5 text-[#9CA3AF] transition-colors hover:bg-[#F3F4F5] hover:text-[#4B5563]",
            collapsed ? "justify-center" : "gap-2",
          )}
        >
          {collapsed
            ? <PanelLeftOpen className="h-[15px] w-[15px]" />
            : <><PanelLeftClose className="h-[15px] w-[15px] shrink-0" /><span style={{ fontSize: 12.5, fontWeight: 500 }}>Collapse</span></>
          }
        </button>

        {!collapsed && user && (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-[#E0E3E6] bg-[#FAFBFB] px-2.5 py-2">
            {user.avatar_url ? (
              <Image
                src={user.avatar_url}
                alt={user.full_name ?? user.email ?? "User"}
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 rounded-full border border-[#9CCFBB] object-cover"
              />
            ) : (
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#9CCFBB] bg-[#E6F4EF] text-[12px] font-bold text-[#006B45]"
              >
                {((user.full_name ?? user.email ?? "?")[0] ?? "?").toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold leading-none text-[#0B0D0F]">
                {user.full_name ?? user.email?.split("@")[0] ?? "Signed in"}
              </p>
              {user.email && (
                <p className="mt-1 truncate font-mono text-[10px] leading-none text-[#9CA3AF]">
                  {user.email}
                </p>
              )}
            </div>
            <button
              type="button"
              title="Sign out"
              onClick={() => { localStorage.removeItem("vectorbea-access-token"); void fetch("/api/auth/session", { method: "DELETE" }).then(() => window.location.assign("/signin")); }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[#9CA3AF] transition-colors hover:bg-[#FEF2F2] hover:text-[#B91C1C]"
            >
              <LogOut className="h-[14px] w-[14px]" />
            </button>
          </div>
        )}

        {/* Sign out fallback when no user object (session-less render) */}
        {!collapsed && !user && (
          <button
            type="button"
            onClick={() => { localStorage.removeItem("vectorbea-access-token"); void fetch("/api/auth/session", { method: "DELETE" }).then(() => window.location.assign("/signin")); }}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-[9px] border border-[#E0E3E6] bg-white text-[12.5px] font-semibold text-[#4B5563] transition-colors hover:bg-[#F7F8F9]"
          >
            <LogOut className="h-3.5 w-3.5 text-[#9CA3AF]" />
            Sign out
          </button>
        )}

        {collapsed && user && (
          <div className="mt-1 flex justify-center">
            {user.avatar_url ? (
              <Image
                src={user.avatar_url}
                alt={user.full_name ?? user.email ?? "User"}
                width={22}
                height={22}
                className="h-[22px] w-[22px] rounded-full border border-[#E0E3E6] object-cover"
              />
            ) : (
              <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#0B0D0F] text-[10px] font-semibold text-white">
                {((user.full_name ?? user.email ?? "?")[0] ?? "?").toUpperCase()}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
