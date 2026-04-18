"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  Boxes,
  Building2,
  ChevronRight,
  ExternalLink,
  LockKeyhole,
  Menu,
  Rocket,
  PlugZap,
  X,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { BeeLogo } from "@/components/brand/bee-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/utils";

// ─── Nav data ─────────────────────────────────────────────────────────────────

const DOCS_NAV: Array<{
  href: Route;
  title: string;
  icon: typeof Rocket;
  section?: string;
}> = [
  { section: "Getting Started", href: "/docs/quickstart" as Route, title: "Quickstart", icon: Rocket },
  { section: "Platform", href: "/docs/architecture" as Route, title: "Architecture", icon: Boxes },
  { href: "/docs/integrations" as Route, title: "Integrations", icon: PlugZap },
  { section: "Enterprise", href: "/docs/enterprise" as Route, title: "Enterprise", icon: Building2 },
  { href: "/docs/security" as Route, title: "Security", icon: LockKeyhole },
];

const DOCS_NAV_GROUPS = DOCS_NAV.reduce<
  Array<{
    section?: string;
    items: Array<{
      href: Route;
      title: string;
      icon: typeof Rocket;
    }>;
  }>
>((groups, item) => {
  if (item.section || groups.length === 0) {
    groups.push({
      section: item.section,
      items: [{ href: item.href, title: item.title, icon: item.icon }],
    });
    return groups;
  }

  groups[groups.length - 1].items.push({
    href: item.href,
    title: item.title,
    icon: item.icon,
  });
  return groups;
}, []);

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({
  open,
  onClose,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
}) {
  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/25 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-30 flex h-screen w-[272px] flex-col border-r border-border bg-muted/[0.18] backdrop-blur transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Logo — matches landing page exactly */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
              <BeeLogo className="h-5 w-5" />
            </div>
            <div className="leading-none">
              <p className="text-[13px] font-semibold tracking-tight text-foreground">
                VectorBea
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Documentation
              </p>
            </div>
          </Link>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground lg:hidden"
          >
            <X size={15} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
          {DOCS_NAV_GROUPS.map((group) => (
            <div key={group.section ?? group.items[0].href}>
              {group.section && (
                <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {group.section}
                </p>
              )}
              {group.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== "/docs" && pathname.startsWith(`${item.href}/`));

                return (
                  <NavItem
                    key={item.href}
                    href={item.href}
                    active={active}
                    Icon={item.icon}
                    title={item.title}
                  />
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-5 py-4">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExternalLink size={11} />
            Back to app
          </Link>
        </div>
      </aside>
    </>
  );
}

function NavItem({
  href,
  active,
  Icon,
  title,
}: {
  href: Route;
  active: boolean;
  Icon: typeof Rocket;
  title: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-[5px] px-2 py-[6px] text-[13px] transition-colors",
        active
          ? "rounded-xl border border-border bg-background font-medium text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
      )}
    >
      <Icon size={13} className="shrink-0" />
      {title}
    </Link>
  );
}

// ─── On-page TOC placeholder (extensible per-page) ───────────────────────────

const TOC_BY_PATH: Record<string, Array<{ label: string; href: string }>> = {
  "/docs/quickstart": [
    { label: "Before you start",         href: "#before-you-start" },
    { label: "Create a workspace",        href: "#step-1" },
    { label: "Create a prompt",           href: "#step-2" },
    { label: "Pull the sidecar",          href: "#step-3" },
    { label: "Register a sidecar",        href: "#step-4" },
    { label: "Run the container",         href: "#step-5" },
    { label: "Install the SDK",           href: "#step-6" },
    { label: "Fetch your prompt",         href: "#step-7" },
    { label: "Moving to production",      href: "#step-9" },
    { label: "Troubleshooting",           href: "#troubleshooting" },
  ],
  "/docs/architecture": [
    { label: "The two-plane model", href: "#overview" },
    { label: "System boundary", href: "#boundary" },
    { label: "Responsibilities", href: "#responsibilities" },
    { label: "Network model", href: "#network-model" },
    { label: "Runtime request flow", href: "#runtime-flow" },
    { label: "Why it matters", href: "#design-principle" },
  ],
  "/docs/integrations": [
    { label: "SDK options", href: "#sdk-options" },
    { label: "Deployment patterns", href: "#deployment-patterns" },
    { label: "Operational signals", href: "#observability" },
    { label: "Rollout workflow", href: "#workflow" },
  ],
  "/docs/enterprise": [
    { label: "Operating model", href: "#operating-model" },
    { label: "Workspace RBAC", href: "#rbac" },
    { label: "Isolation", href: "#isolation" },
    { label: "Security posture", href: "#security" },
    { label: "Seat governance", href: "#billing" },
    { label: "Recommended model", href: "#recommended-model" },
  ],
  "/docs/security": [
    { label: "Network model", href: "#network" },
    { label: "Data boundary", href: "#data" },
    { label: "Token model", href: "#tokens" },
  ],
};

function TableOfContents({ pathname }: { pathname: string }) {
  const items = TOC_BY_PATH[pathname];
  if (!items) return null;
  return (
    <aside className="hidden w-[220px] shrink-0 xl:block">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        On this page
      </p>
      <ul className="space-y-2">
        {items.map((t) => (
          <li key={t.href}>
            <a
              href={t.href}
              className="block text-[12px] leading-snug text-muted-foreground transition-colors hover:text-foreground"
            >
              {t.label}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

const TITLE_BY_PATH: Record<string, string> = {
  "/docs":               "Quickstart",
  "/docs/quickstart":    "Quickstart",
  "/docs/architecture":  "Architecture",
  "/docs/integrations":  "Integrations",
  "/docs/enterprise":    "Enterprise",
  "/docs/security":      "Security",
};

function Breadcrumb({ pathname }: { pathname: string }) {
  const title = TITLE_BY_PATH[pathname] ?? "Docs";
  return (
    <nav className="mb-7 flex items-center gap-1 text-[12px] text-muted-foreground">
      <Link href="/" className="transition-colors hover:text-foreground">Home</Link>
      <ChevronRight size={11} className="text-border" />
      <Link href="/docs" className="transition-colors hover:text-foreground">Docs</Link>
      {pathname !== "/docs" && (
        <>
          <ChevronRight size={11} className="text-border" />
          <span className="font-medium text-foreground">{title}</span>
        </>
      )}
    </nav>
  );
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        pathname={pathname}
      />

      {/* Offset content for fixed sidebar */}
      <div className="lg:pl-[272px]">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-background px-4 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Menu size={17} />
          </button>
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
              <BeeLogo className="h-[18px] w-[18px]" />
            </div>
            <div className="leading-none">
              <p className="text-[13px] font-semibold tracking-tight text-foreground">VectorBea</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Documentation</p>
            </div>
          </Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        {/* Desktop right-side theme toggle */}
        <div className="fixed right-4 top-[11px] z-20 hidden lg:block">
          <ThemeToggle />
        </div>

        {/* Main layout */}
        <div className="mx-auto max-w-[1400px] px-6 pt-10 lg:px-10 xl:px-12">
          <div className="flex items-start gap-10">
            <main className="min-w-0 flex-1 max-w-[78ch]">
              <Breadcrumb pathname={pathname} />
              {children}
            </main>
            <TableOfContents pathname={pathname} />
          </div>
        </div>
      </div>
    </div>
  );
}
