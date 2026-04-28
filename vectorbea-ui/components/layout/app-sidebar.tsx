"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  Bell,
  CalendarClock,
  CreditCard,
  ArrowUpRight,
  BookOpen,
  Database,
  FlaskConical,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogOut,
  Logs,
  Server,
  Settings2,
  Sparkles,
  Star,
  Users,
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import type { DashboardSummary } from "@/lib/api";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRBAC, useWorkspace } from "@/lib/workspace-context";

const ALL_NAV_ITEMS: Array<{
  href: Route;
  label: string;
  icon: typeof LayoutDashboard;
  minRole?: "admin" | "editor" | "viewer";
  isSubItem?: boolean;
}> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/metrics", label: "Metrics", icon: BarChart3 },
  { href: "/dashboard/infrastructure", label: "Infrastructure", icon: Server },
  { href: "/prompts", label: "Prompts", icon: Sparkles },
  { href: "/audit-logs", label: "Audit Logs", icon: Logs },
  { href: "/traces", label: "Traces", icon: GitBranch },
  { href: "/evaluations", label: "Evaluations", icon: FlaskConical },
  { href: "/evaluations/datasets", label: "Baseline Datasets", icon: Database, isSubItem: true },
  { href: "/evaluations/golden", label: "Golden Traces", icon: Star, isSubItem: true },
  { href: "/evaluations/schedules", label: "Scheduled Regressions", icon: CalendarClock, isSubItem: true },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/api-keys", label: "API Keys", icon: KeyRound, minRole: "admin" },
  { href: "/settings/billing", label: "Billing", icon: CreditCard },
  { href: "/settings/members", label: "Members", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

type SidebarUser = { email: string | null; full_name: string | null; avatar_url: string | null } | null;

export function AppSidebar({ summary, user }: { summary: DashboardSummary | null; user?: SidebarUser }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [workspaceSummary, setWorkspaceSummary] = useState<DashboardSummary | null>(summary);
  const { isAdmin, isEditor } = useRBAC();
  const { activeWorkspaceId } = useWorkspace();

  const navigation = useMemo(() => {
    return ALL_NAV_ITEMS.filter((item) => {
      if (!item.minRole) return true;
      if (item.minRole === "admin") return isAdmin;
      if (item.minRole === "editor") return isEditor;
      return true;
    });
  }, [isAdmin, isEditor]);

  // Clear pending indicator once navigation settles
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspaceSummary() {
      if (!activeWorkspaceId) {
        setWorkspaceSummary(summary);
        return;
      }

      try {
        const response = await fetch(
          `/api/dashboard/summary?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error("Failed to load workspace summary");
        const nextSummary = (await response.json()) as DashboardSummary;
        if (!cancelled) setWorkspaceSummary(nextSummary);
      } catch {
        if (!cancelled) setWorkspaceSummary(null);
      }
    }

    void loadWorkspaceSummary();
    return () => { cancelled = true; };
  }, [activeWorkspaceId, summary]);

  return (
    <aside className="sidebar-scroll hidden h-full w-[232px] shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col">

      {/* Logo + workspace */}
      <div className="px-4 pb-3 pt-5">
        <div className="mb-4 flex items-center gap-2.5 px-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] shadow-xs">
            <Logo />
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-sidebar-fg">VectorBea</span>
        </div>
        <WorkspaceSwitcher />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pb-3">
        <div className="space-y-0.5">
          {navigation.map((item) => {
            if (item.isSubItem && !pathname.startsWith("/evaluations")) return null;

            const Icon = item.icon;
            const fullHref = `${item.href}${currentQuery ? `?${currentQuery}` : ""}`;
            const active =
              pathname === item.href ||
              (pathname.startsWith(`${item.href}/`) &&
                !navigation.some(
                  (other) =>
                    other.href !== item.href &&
                    (pathname === other.href || pathname.startsWith(`${other.href}/`)),
                ));
            const loading = isPending && pendingHref === fullHref;

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
                  item.isSubItem ? "pl-8 pr-3 py-1.5 text-[12px]" : "px-3 py-1.5 text-[13px]",
                  active
                    ? "bg-sidebar-active text-sidebar-fg font-medium"
                    : "text-sidebar-muted font-normal hover:bg-sidebar-hover hover:text-sidebar-fg",
                  loading && "opacity-60",
                )}
              >
                <Icon
                  className={cn(
                    "h-[15px] w-[15px] shrink-0 transition-colors",
                    active ? "text-brand-muted" : "text-sidebar-muted/70 group-hover:text-sidebar-fg",
                    loading && "opacity-0",
                  )}
                />
                {loading && (
                  <Loader2 className={cn(
                    "absolute h-[14px] w-[14px] animate-spin text-primary",
                    item.isSubItem ? "left-8" : "left-3"
                  )} />
                )}
                <span className="truncate flex-1">{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Divider before bottom links */}
        <div className="mb-2 mt-4 border-t border-sidebar-border" />

        <a
          href="/docs/overview"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] text-sidebar-muted transition-all duration-150 hover:bg-sidebar-hover hover:text-sidebar-fg"
        >
          <BookOpen className="h-[15px] w-[15px] shrink-0" />
          <span className="flex-1">Documentation</span>
          <ArrowUpRight className="h-3 w-3 shrink-0 opacity-50" />
        </a>
      </nav>

      {/* Bottom: sidecar status + user */}
      <div className="space-y-2 border-t border-sidebar-border px-3 py-3">
        {/* Sidecar pill */}
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2">
          <span className={cn("live-dot h-1.5 w-1.5", !workspaceSummary && "!bg-red-500")} />
          <div className="flex-1 min-w-0">
            <p className="truncate text-[11px] font-medium text-sidebar-fg">
              {workspaceSummary ? `${workspaceSummary.averageLatencyMs} ms` : "—"}
            </p>
            <p className="text-[10px] text-sidebar-muted">
              {workspaceSummary ? `${workspaceSummary.activeAgents} sidecars live` : "No sidecar connected"}
            </p>
          </div>
          <Badge variant={workspaceSummary ? "success" : "destructive"} className="text-[10px] px-1.5 py-0.5 shrink-0">
            {workspaceSummary ? "Live" : "Off"}
          </Badge>
        </div>

        {/* User */}
        {user && (
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            {user.avatar_url ? (
              <Image
                src={user.avatar_url}
                alt={user.full_name ?? user.email ?? "User"}
                width={24}
                height={24}
                className="h-6 w-6 shrink-0 rounded-full border border-white/15 object-cover"
              />
            ) : (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-[10px] font-semibold text-sidebar-muted">
                {((user.full_name ?? user.email ?? "?")[0] ?? "?").toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium leading-none text-sidebar-fg">
                {user.full_name ?? user.email?.split("@")[0] ?? "User"}
              </p>
              {user.email && (
                <p className="mt-0.5 truncate text-[10px] text-sidebar-muted">{user.email}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void fetch("/api/auth/session", { method: "DELETE" }).then(() => window.location.assign("/login"))}
              title="Sign out"
              className="shrink-0 rounded p-1 text-sidebar-muted transition-colors hover:bg-white/[0.08] hover:text-sidebar-fg"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

