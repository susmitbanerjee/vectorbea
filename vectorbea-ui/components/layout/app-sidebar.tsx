"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CreditCard,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Logs,
  Server,
  Settings2,
  Sparkles,
  UserCircle,
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
}> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/infrastructure", label: "Infrastructure", icon: Server },
  { href: "/prompts", label: "Prompts", icon: Sparkles },
  { href: "/audit-logs", label: "Audit Logs", icon: Logs },
  { href: "/api-keys", label: "API Keys", icon: KeyRound, minRole: "admin" },
  { href: "/settings/billing", label: "Billing", icon: CreditCard },
  { href: "/settings/profile", label: "Profile", icon: UserCircle },
  { href: "/settings/members", label: "Members", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export function AppSidebar({ summary }: { summary: DashboardSummary | null }) {
  const pathname = usePathname();
  const router = useRouter();
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
        if (!response.ok) {
          throw new Error("Failed to load workspace summary");
        }
        const nextSummary = (await response.json()) as DashboardSummary;
        if (!cancelled) {
          setWorkspaceSummary(nextSummary);
        }
      } catch {
        if (!cancelled) {
          setWorkspaceSummary(null);
        }
      }
    }

    void loadWorkspaceSummary();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, summary]);

  const navigate = (href: string) => {
    const target = href.split("?")[0];
    if (pathname === target || pendingHref === href) return;
    setPendingHref(href);
    startTransition(() => {
      router.push(href as Route);
    });
  };

  return (
    <aside className="hidden w-[260px] shrink-0 border-r border-border/50 bg-card/30 px-3 py-4 backdrop-blur-sm lg:flex lg:flex-col">
      <div className="mb-6 flex items-center gap-3 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card">
          <Logo />
        </div>
        <div>
          <p className="text-sm font-semibold tracking-tight">VectorBea</p>
          <p className="text-[11px] text-muted-foreground">Prompt Registry</p>
        </div>
      </div>

      <WorkspaceSwitcher />

      <nav className="mt-5 flex flex-col gap-0.5">
        {navigation.map((item) => {
          const Icon = item.icon;
          const fullHref = `${item.href}${currentQuery ? `?${currentQuery}` : ""}`;
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const loading = isPending && pendingHref === fullHref;

          return (
            <button
              key={item.href}
              type="button"
              onClick={() => navigate(fullHref)}
              disabled={loading}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-all duration-200",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                loading && "opacity-80",
              )}
            >
              {active && (
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
                <Loader2 className="absolute left-3 h-4 w-4 animate-spin text-primary" />
              )}
              <span className="flex-1">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto rounded-xl border border-border/50 bg-card/60 p-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className={cn("live-dot", !workspaceSummary && "!bg-red-500")} />
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            System Status
          </p>
        </div>
        {workspaceSummary ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xl font-semibold tabular-nums">
                {workspaceSummary.averageLatencyMs} ms
              </p>
              <p className="text-[11px] text-muted-foreground">
                Avg latency · {workspaceSummary.activeAgents} agents
              </p>
            </div>
            <Badge variant="success">Connected</Badge>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xl font-semibold tabular-nums">-</p>
              <p className="text-[11px] text-muted-foreground">Backend unreachable</p>
            </div>
            <Badge variant="destructive">Offline</Badge>
          </div>
        )}
      </div>
    </aside>
  );
}
