"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  Boxes,
  Building2,
  Rocket,
} from "lucide-react";
import type { ReactNode } from "react";

import { BeeLogo } from "@/components/brand/bee-logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/utils";

const DOCS_NAV: Array<{
  href: Route;
  title: string;
  description: string;
  icon: typeof BookOpenText;
}> = [
  {
    href: "/docs",
    title: "Introduction",
    description:
      "What VectorBea is and how the platform is split between cloud control and local execution.",
    icon: BookOpenText,
  },
  {
    href: "/docs/quickstart",
    title: "Quickstart",
    description: "Deploy the Dockerized proxy and point your local agents at it.",
    icon: Rocket,
  },
  {
    href: "/docs/architecture",
    title: "Architecture",
    description: "Understand the sidecar, the sync loop, and the isolation boundary.",
    icon: Boxes,
  },
  {
    href: "/docs/enterprise",
    title: "Enterprise",
    description: "RBAC, project isolation, row-level security, and per-seat billing.",
    icon: Building2,
  },
];

export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-4 py-3 md:px-6 xl:px-10">
          <Link href="/" className="inline-flex items-center gap-3">
            <BeeLogo className="h-8 w-8" />
            <div>
              <p className="text-sm font-semibold tracking-tight">VectorBea</p>
              <p className="text-xs text-muted-foreground">Documentation</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link
              href="/signup"
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-accent/60"
            >
              Create account
            </Link>
          </div>
        </div>
      </header>

      <div className="docs-shell-grid">
        <div className="mx-auto grid w-full max-w-[1400px] gap-8 px-4 py-8 md:px-6 lg:grid-cols-[280px_minmax(0,1fr)] xl:px-10">
          <aside className="h-fit lg:sticky lg:top-24">
            <div className="rounded-[1.5rem] border border-border/80 bg-card/95 p-4 shadow-[0_20px_70px_-48px_rgba(15,23,42,0.35)]">
              <div className="mb-4 px-2">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Documentation
                </p>
              </div>
              <nav className="space-y-1.5">
                {DOCS_NAV.map((item) => {
                  const Icon = item.icon;
                  const active =
                    pathname === item.href ||
                    (item.href !== "/docs" && pathname.startsWith(`${item.href}/`));

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "block rounded-xl border px-3 py-3 transition-colors",
                        active
                          ? "border-brand/20 bg-brand/5"
                          : "border-transparent hover:border-border hover:bg-muted/40",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                            active
                              ? "bg-brand/10 text-brand"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </nav>
            </div>
          </aside>

          <main className="min-w-0">
            <article className="mx-auto max-w-[65ch] px-1 py-4 lg:py-8">
              <div className="docs-prose">{children}</div>
            </article>
          </main>
        </div>
      </div>
    </div>
  );
}
