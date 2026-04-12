"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  BookOpenText,
  Boxes,
  Building2,
  Rocket,
} from "lucide-react";
import type { ReactNode } from "react";

import { BeeLogo } from "@/components/brand/bee-logo";
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(18,214,197,0.08),_transparent_28%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,1))] text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 md:px-6 xl:px-8">
          <Link href="/" className="inline-flex items-center gap-3">
            <BeeLogo className="h-9 w-9" />
            <div>
              <p className="text-sm font-semibold tracking-tight">VectorBea</p>
              <p className="text-xs text-muted-foreground">Documentation</p>
            </div>
          </Link>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            Launch setup
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <div className="surface-grid border-b border-border/60 bg-gradient-to-br from-background via-background to-sky-50/80">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-10 md:px-6 xl:px-8">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-primary">
            <BookOpenText className="h-3.5 w-3.5" />
            VectorBea Docs
          </div>
          <div className="max-w-3xl space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Build, govern, and ship AI prompts without moving your execution
              into someone else&apos;s cloud.
            </h1>
            <p className="max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
              These docs cover the Docker proxy, the control plane, and the
              enterprise isolation model that keeps prompts scoped to the right
              organization and project.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              [
                "Control plane",
                "Organizations, RBAC, billing, and prompt governance run from Supabase and Vercel.",
              ],
              [
                "Local execution",
                "Agents and sidecars stay in the customer environment, close to data and model traffic.",
              ],
              [
                "Enterprise safe",
                "Project isolation and database-backed policies prevent cross-project prompt access.",
              ],
            ].map(([title, body]) => (
              <div
                key={title}
                className="rounded-[1.5rem] border border-border/60 bg-white/75 p-4 shadow-[0_20px_60px_-40px_rgba(18,62,171,0.35)] backdrop-blur-sm"
              >
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-8 md:px-6 lg:grid-cols-[300px_minmax(0,1fr)] xl:px-8">
        <aside className="h-fit rounded-[1.75rem] border border-border/60 bg-white/80 p-4 shadow-[0_24px_80px_-50px_rgba(18,62,171,0.35)] backdrop-blur-sm lg:sticky lg:top-24">
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
                      ? "border-primary/25 bg-primary/10"
                      : "border-transparent hover:border-border/70 hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                        active
                          ? "bg-primary/15 text-primary"
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
        </aside>

        <main className="min-w-0 rounded-[2rem] border border-border/60 bg-white/88 p-6 shadow-[0_32px_90px_-50px_rgba(18,62,171,0.35)] backdrop-blur-sm sm:p-8">
          <article className="docs-prose mx-auto max-w-4xl">{children}</article>
        </main>
      </div>
    </div>
  );
}
