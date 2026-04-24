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
    // h-full fills the locked h-screen parent; overflow-y-auto lets the sidebar
    // scroll independently if the nav list ever overflows (e.g. small viewports)
    // while keeping mt-auto pinning the sign-out card to the bottom.
    <aside className="hidden w-[260px] shrink-0 border-r border-border/50 bg-card/30 px-3 py-4 backdrop-blur-sm lg:flex lg:flex-col h-full overflow-y-auto">
      <div className="mb-6 flex items-center gap-3 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card">
          <Logo />
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">VectorBea</p>
          <p className="text-[11px] text-muted-foreground">Enterprise AI Infrastructure Platform</p>
        </div>
      </div>

      <WorkspaceSwitcher />

      <nav className="mt-5 flex flex-col gap-0.5">
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
            // Use <Link> so browser back/forward, middle-click, and right-click
            // "open in new tab" all work correctly. onClick marks the transition
            // pending for the loading spinner without bypassing Link's own
            // history management.
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
                "group relative flex w-full items-center gap-3 rounded-lg py-2 text-left font-medium transition-all duration-200",
                item.isSubItem
                  ? "pl-7 text-[12px]"
                  : "px-3 text-[13px]",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                loading && "opacity-80",
              )}
            >
              {active && !item.isSubItem && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
              )}
              <Icon
                className={cn(
                  "h-4 w-4 transition-colors",
                  active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  loading && "opacity-0",
                )}
              />
              {loading && (
                <Loader2 className={cn("absolute h-4 w-4 animate-spin text-primary", item.isSubItem ? "left-7" : "left-3")} />
              )}
              <span className="flex-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <Link
          href={"/docs/overview" as any}
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-accent/40 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          <BookOpen className="h-4 w-4 shrink-0" />
          <span className="flex-1">Documentation</span>
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
        </Link>

        {user && (
          <div className="flex items-center gap-2.5 rounded-xl border border-border/50 bg-card/60 px-3 py-2.5">
            {user.avatar_url ? (
              <Image
                src={user.avatar_url}
                alt={user.full_name ?? user.email ?? "User"}
                width={28}
                height={28}
                className="h-7 w-7 rounded-full border border-border/60 object-cover shrink-0"
              />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted text-[11px] font-semibold text-muted-foreground">
                {((user.full_name ?? user.email ?? "?")[0] ?? "?").toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              {user.full_name && (
                <p className="truncate text-[12px] font-medium leading-none">{user.full_name}</p>
              )}
              {user.email && (
                <p className="truncate text-[10px] text-muted-foreground leading-none mt-0.5">{user.email}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                void fetch("/api/auth/session", { method: "DELETE" }).then(() => {
                  window.location.assign("/login");
                });
              }}
              title="Sign out"
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="rounded-xl border border-border/50 bg-card/60 p-4 backdrop-blur-sm">
          <div className="mb-3 flex items-center gap-2">
            <span className={cn("live-dot", !workspaceSummary && "!bg-red-500")} />
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              Sidecar Status
            </p>
          </div>
          {workspaceSummary ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-semibold tabular-nums">
                  {workspaceSummary.averageLatencyMs} ms
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {workspaceSummary.averageLatencyMs} ms avg · {workspaceSummary.activeAgents} sidecars live
                </p>
              </div>
              <Badge variant="success">Connected</Badge>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-semibold tabular-nums">-</p>
                <p className="text-[11px] text-muted-foreground">No sidecar connected</p>
              </div>
              <Badge variant="destructive">Disconnected</Badge>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
