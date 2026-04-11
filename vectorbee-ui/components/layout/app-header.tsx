"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { KeyRound, LayoutDashboard, Logs, Search, Settings2, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { NotificationsPopover } from "@/components/layout/notifications-popover";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useRBAC } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";

const mobileNavigation: Array<{
  href: Route;
  label: string;
  icon: typeof LayoutDashboard;
  minRole?: "admin" | "editor" | "viewer";
}> = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/prompts", label: "Prompts", icon: Sparkles },
  { href: "/audit-logs", label: "Audit", icon: Logs },
  { href: "/api-keys", label: "Keys", icon: KeyRound, minRole: "admin" },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export function AppHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [searchFocused, setSearchFocused] = useState(false);
  const { isAdmin, isEditor } = useRBAC();

  useEffect(() => {
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  const pushSearch = (nextQuery: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextQuery.trim()) {
      params.set("q", nextQuery.trim());
    } else {
      params.delete("q");
    }
    const nextUrl = `${pathname}${params.toString() ? `?${params}` : ""}`;
    const currentUrl = `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`;
    if (nextUrl !== currentUrl) {
      router.push(nextUrl as Route);
    }
  };

  useEffect(() => {
    const handle = window.setTimeout(() => pushSearch(query), 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    pushSearch(query);
  };

  const currentQuery = searchParams.toString();
  const visibleMobileNavigation = mobileNavigation.filter((item) => {
    if (!item.minRole) return true;
    if (item.minRole === "admin") return isAdmin;
    if (item.minRole === "editor") return isEditor;
    return true;
  });

  return (
    <header className="sticky top-0 z-20 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="flex flex-col gap-3 px-4 py-4 md:px-6 xl:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="animate-fade-in">
            <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">{actions}</div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <form className="relative w-full md:max-w-sm" onSubmit={submitSearch}>
            <Search className={cn(
              "pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transition-colors",
              searchFocused ? "text-primary" : "text-muted-foreground",
            )} />
            <input
              className={cn(
                "flex h-9 w-full rounded-lg border bg-background/50 pl-9 pr-3 py-1 text-sm transition-all duration-200 placeholder:text-muted-foreground/50 focus:outline-none",
                searchFocused
                  ? "border-primary/50 ring-2 ring-primary/20 bg-background"
                  : "border-border/60",
              )}
              placeholder="Search..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(""); pushSearch(""); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </form>
          <div className="flex items-center gap-1 self-end md:self-auto">
            <NotificationsPopover />
            <ThemeToggle />
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden">
          {visibleMobileNavigation.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={`${item.href}${currentQuery ? `?${currentQuery}` : ""}` as Route}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all duration-200",
                  active
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border/50 bg-card/50 text-muted-foreground hover:bg-accent/30",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </header>
  );
}
