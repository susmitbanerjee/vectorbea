"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Activity,
  BadgeCheck,
  Bot,
  CheckCircle2,
  ClipboardList,
  Cloud,
  Code2,
  Cpu,
  CreditCard,
  Database,
  ExternalLink,
  FileBarChart2,
  FileSearch,
  FileText,
  FileUp,
  FlaskConical,
  GitBranch,
  GitMerge,
  History,
  KeyRound,
  LayoutDashboard,
  Layers,
  LockKeyhole,
  Loader2,
  LogOut,
  Package,
  Plug,
  Radio,
  Scale,
  Server,
  Settings2,
  Shield,
  Sparkles,
  TriangleAlert,
  Users,
  Zap,
} from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import type { DashboardSummary } from "@/lib/api";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRBAC, useWorkspace } from "@/lib/workspace-context";

// ─── Route group matchers ─────────────────────────────────────────────────────

function isRegistryRoute(p: string) {
  return (
    p === "/registry" || p.startsWith("/registry/")
  );
}
function isEvidenceRoute(p: string) {
  return (
    p === "/evidence" || p.startsWith("/evidence/") ||
    p === "/evaluations/datasets" || p.startsWith("/evaluations/datasets/")
  );
}
function isReleaseGatesRoute(p: string) {
  return p === "/release-gates" || p.startsWith("/release-gates/");
}
function isPoliciesRoute(p: string) {
  return (
    p === "/policies" || p.startsWith("/policies/") ||
    p === "/governance/policy-packs" || p.startsWith("/governance/policy-packs/")
  );
}
function isApprovalsRoute(p: string) {
  return (
    p === "/approvals" || p.startsWith("/approvals/") ||
    p === "/governance/approvals" || p.startsWith("/governance/approvals/")
  );
}
function isAuditRoute(p: string) {
  return (
    p === "/audit" || p.startsWith("/audit/") ||
    p === "/governance/audit" || p.startsWith("/governance/audit/") ||
    p === "/audit-logs" || p.startsWith("/audit-logs/") ||
    p === "/settings/audit" || p.startsWith("/settings/audit/")
  );
}
function isReportsRoute(p: string) {
  return (
    p === "/reports" || p.startsWith("/reports/") ||
    p === "/governance/reports" || p.startsWith("/governance/reports/")
  );
}
function isIntegrationsRoute(p: string) {
  return (
    p === "/integrations" || p.startsWith("/integrations/") ||
    p === "/settings/sdk" || p.startsWith("/settings/sdk")
  );
}
function isSettingsRoute(p: string) {
  return (
    (p === "/settings" || p.startsWith("/settings/")) ||
    p === "/governance/privacy" || p.startsWith("/governance/privacy/") ||
    p === "/api-keys" || p.startsWith("/api-keys/")
  );
}

// ─── Navigation definition ────────────────────────────────────────────────────

type NavItem = {
  href: Route;
  label: string;
  icon: React.ElementType;
  minRole?: "admin" | "editor";
  isSubItem?: boolean;
  /** Pathname prefix or custom fn that determines visibility of sub-items */
  subItemGroup?: string | ((p: string) => boolean);
};

const NAV: NavItem[] = [
  // ── Dashboard ──
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },

  // ── AI Registry ──
  { href: "/registry/systems", label: "AI Systems", icon: Bot },
  // ── Evaluation Evidence ──
  { href: "/evidence/runs", label: "Evaluation Evidence", icon: FlaskConical },
  {
    href: "/evidence/runs",
    label: "Evidence Runs",
    icon: ClipboardList,
    isSubItem: true,
    subItemGroup: isEvidenceRoute,
  },
  {
    href: "/evaluations/datasets",
    label: "Evidence Datasets",
    icon: ClipboardList,
    isSubItem: true,
    subItemGroup: isEvidenceRoute,
  },

  // ── Release Gates ──
  { href: "/release-gates", label: "Release Gates", icon: GitMerge },

  // ── Policies ──
  { href: "/governance/policy-packs", label: "Policies", icon: Scale },

  // ── Approvals ──
  { href: "/governance/approvals", label: "Approvals", icon: BadgeCheck },

  // ── Audit ──
  { href: "/governance/audit", label: "Audit", icon: History },

  // ── Incidents ──
  { href: "/incidents", label: "Incidents", icon: TriangleAlert },

  // ── Reports ──
  { href: "/governance/reports", label: "Reports", icon: FileBarChart2 },

  // ── Integrations ──
  { href: "/integrations" as Route, label: "Integrations", icon: Plug },
  {
    href: "/integrations/overview" as Route,
    label: "Overview",
    icon: Shield,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/sidecar" as Route,
    label: "Sidecar",
    icon: Server,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/opentelemetry" as Route,
    label: "OpenTelemetry",
    icon: Radio,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/sdk" as Route,
    label: "SDK",
    icon: Code2,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/llm-providers" as Route,
    label: "LLM Providers",
    icon: Cpu,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/mcp" as Route,
    label: "MCP Servers",
    icon: Package,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/rag" as Route,
    label: "RAG Pipelines",
    icon: Database,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/classification" as Route,
    label: "Classification",
    icon: Layers,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/extraction" as Route,
    label: "Extraction",
    icon: FileSearch,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/skills" as Route,
    label: "Skill Runtimes",
    icon: Zap,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/ci-cd" as Route,
    label: "CI/CD",
    icon: GitBranch,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/uploads" as Route,
    label: "Manual Uploads",
    icon: FileUp,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/discovered-systems" as Route,
    label: "Discovered Systems",
    icon: Sparkles,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/coverage" as Route,
    label: "Coverage",
    icon: CheckCircle2,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },
  {
    href: "/integrations/health" as Route,
    label: "Health",
    icon: Activity,
    isSubItem: true,
    subItemGroup: isIntegrationsRoute,
  },

  // ── Settings ──
  { href: "/settings", label: "Settings", icon: Settings2 },
  {
    href: "/settings/billing",
    label: "Billing",
    icon: CreditCard,
    isSubItem: true,
    subItemGroup: isSettingsRoute,
  },
  {
    href: "/settings/members",
    label: "Members",
    icon: Users,
    isSubItem: true,
    subItemGroup: isSettingsRoute,
  },
  {
    href: "/settings/usage",
    label: "Usage",
    icon: FileBarChart2,
    isSubItem: true,
    subItemGroup: isSettingsRoute,
  },
  {
    href: "/api-keys",
    label: "API Keys",
    icon: KeyRound,
    isSubItem: true,
    subItemGroup: isSettingsRoute,
    minRole: "admin",
  },
  {
    href: "/governance/privacy",
    label: "Privacy Controls",
    icon: LockKeyhole,
    isSubItem: true,
    subItemGroup: isSettingsRoute,
  },
  {
    href: "/settings/production-readiness",
    label: "Production Checklist",
    icon: Activity,
    isSubItem: true,
    subItemGroup: isSettingsRoute,
    minRole: "admin",
  },
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
  const { activeWorkspaceId, planTier } = useWorkspace();

  const navigation = useMemo(() => {
    return NAV.filter((item) => {
      if (!item.minRole) return true;
      if (item.minRole === "admin") return isAdmin;
      if (item.minRole === "editor") return isEditor || isAdmin;
      return true;
    });
  }, [isAdmin, isEditor]);

  useEffect(() => { setPendingHref(null); }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeWorkspaceId) { setWorkspaceSummary(summary); return; }
      try {
        const res = await fetch(
          `/api/dashboard/summary?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
          { cache: "no-store" },
        );
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

  return (
    <aside className="sidebar-scroll hidden h-full w-[248px] shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar lg:flex lg:flex-col">

      {/* Logo + workspace */}
      <div className="px-4 pb-3 pt-5">
        <div className="mb-4 flex items-center gap-2.5 px-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background shadow-xs">
            <Logo />
          </div>
          <span className="text-[13px] font-semibold tracking-tight text-sidebar-fg">VectorBea</span>
        </div>
        <WorkspaceSwitcher />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pb-3">
        <div className="space-y-0.5">
          {navigation.map((item, idx) => {
            // Determine if this sub-item should be shown
            if (item.isSubItem) {
              const sg = item.subItemGroup;
              const visible =
                typeof sg === "function"
                  ? sg(pathname)
                  : typeof sg === "string"
                    ? pathname.startsWith(sg)
                    : false;
              if (!visible) return null;
            }

            const Icon = item.icon;
            const fullHref = `${item.href}${currentQuery ? `?${currentQuery}` : ""}`;

            // Active state: exact match or prefix
            const active =
              pathname === item.href ||
              (pathname.startsWith(`${item.href}/`) &&
                !navigation.some(
                  (other) =>
                    other.href !== item.href &&
                    (pathname === other.href || pathname.startsWith(`${other.href}/`)) &&
                    other.href.length > item.href.length,
                ));

            const loading = isPending && pendingHref === fullHref;

            return (
              <Link
                key={`nav-${idx}`}
                href={fullHref as Route}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (pathname === item.href || pendingHref === fullHref) return;
                  setPendingHref(fullHref);
                  startTransition(() => {});
                }}
                className={cn(
                  "group relative flex w-full items-center gap-2.5 rounded-md text-left transition-all duration-150",
                  item.isSubItem ? "pl-8 pr-3 py-1.5 text-[12px]" : "px-3 py-2 text-[13px]",
                  active
                    ? "bg-sidebar-active text-sidebar-fg font-semibold"
                    : "text-sidebar-muted font-normal hover:bg-sidebar-hover hover:text-sidebar-fg",
                  loading && "opacity-60",
                )}
              >
                <Icon
                  className={cn(
                    "shrink-0 transition-colors",
                    item.isSubItem ? "h-[13px] w-[13px]" : "h-[15px] w-[15px]",
                    active ? "text-sidebar-fg" : "text-sidebar-muted/80 group-hover:text-sidebar-fg",
                    loading && "opacity-0",
                  )}
                />
                {loading && (
                  <Loader2
                    className={cn(
                      "absolute h-[14px] w-[14px] animate-spin text-primary",
                      item.isSubItem ? "left-8" : "left-3",
                    )}
                  />
                )}
                <span className="flex-1 truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Divider before docs */}
        <div className="mb-2 mt-4 border-t border-sidebar-border" />

        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[12px] text-sidebar-muted transition-all duration-150 hover:bg-sidebar-hover hover:text-sidebar-fg"
        >
          <ExternalLink className="h-[13px] w-[13px] shrink-0" />
          <span className="flex-1">Documentation</span>
        </a>
      </nav>

      {/* Bottom: evidence source status + user */}
      <div className="space-y-2 border-t border-sidebar-border px-3 py-3">
        {/* Evidence source pill */}
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
          <span className={cn("live-dot h-1.5 w-1.5", !workspaceSummary && "!bg-red-500")} />
          <div className="flex-1 min-w-0">
            <p className="truncate text-[11px] font-medium text-sidebar-fg">
              {workspaceSummary ? `${workspaceSummary.averageLatencyMs} ms` : "—"}
            </p>
            <p className="text-[10px] text-sidebar-muted">
              {workspaceSummary
                ? `${workspaceSummary.activeAgents} evidence source${workspaceSummary.activeAgents === 1 ? "" : "s"} active`
                : "No evidence sources connected"}
            </p>
          </div>
          <Badge
            variant={workspaceSummary ? "success" : "destructive"}
            className="text-[10px] px-1.5 py-0.5 shrink-0"
          >
            {workspaceSummary ? "Live" : "Off"}
          </Badge>
        </div>

        {/* Plan badge */}
        {planTier && planTier !== "free" && (
          <div className="px-2 pb-0.5">
            <span
              className={[
                "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                planTier === "enterprise"
                  ? "bg-[#1E1B4B]/10 text-[#3730A3]"
                  : planTier === "pro"
                    ? "bg-[#2563EB]/10 text-[#1D4ED8]"
                    : "bg-[#7C3AED]/10 text-[#6D28D9]",
              ].join(" ")}
            >
              {planTier === "pro" ? "Pro" : planTier === "enterprise" ? "Enterprise" : "Plus"}
            </span>
          </div>
        )}

        {/* User */}
        {user && (
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            {user.avatar_url ? (
              <Image
                src={user.avatar_url}
                alt={user.full_name ?? user.email ?? "User"}
                width={24}
                height={24}
                className="h-6 w-6 shrink-0 rounded-full border border-border object-cover"
              />
            ) : (
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted/60 text-[10px] font-semibold text-sidebar-muted">
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
              onClick={() =>
                void fetch("/api/auth/session", { method: "DELETE" }).then(() =>
                  window.location.assign("/login"),
                )
              }
              title="Sign out"
              className="shrink-0 rounded p-1 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-fg"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
