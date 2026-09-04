"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, KeyRound, LayoutDashboard, Logs, Search, Settings2 } from "lucide-react";
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
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/audit-logs", label: "Audit", icon: Logs },
  { href: "/api-keys", label: "Keys", icon: KeyRound, minRole: "admin" },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

export function AppHeader({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Optional mono uppercase label shown above the title (e.g. "OVERVIEW"). */
  eyebrow?: string;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <header
      className="sticky top-0 z-20"
      style={{
        background: "var(--bg-main)",
        borderBottom: "1px solid var(--legacy-border-subtle)",
      }}
    >
      {/* ── Main header row ────────────────────────────────────────────── */}
      <div className="flex min-h-[60px] items-center gap-4 px-6 py-2.5">
        {/* Title */}
        <div className="flex-1 min-w-0">
          {eyebrow && (
            <span className="vb-mono-label mb-0.5 block leading-none">{eyebrow}</span>
          )}
          <h1 className="text-[22px] font-bold leading-[1.15] tracking-[-0.022em] text-[#0B0D0F]">{title}</h1>
          {subtitle && (
            <p className="mt-0.5 hidden text-[13px] text-[#6B7280] sm:block">{subtitle}</p>
          )}
        </div>

        {/* Search */}
        <form
          className="relative hidden md:flex items-center"
          onSubmit={submitSearch}
        >
          <Search className={cn(
            "pointer-events-none absolute left-2.5 h-3.5 w-3.5 transition-colors",
            searchFocused ? "text-[#007F4E]" : "text-[#9CA3AF]",
          )} />
          <input
            className={cn(
              "h-9 w-52 rounded-[8px] border bg-white pl-8 pr-3 text-[13px] transition-all placeholder:text-[#9CA3AF] focus:outline-none focus:w-64",
              searchFocused
                ? "border-[#9CCFBB] ring-2 ring-[#E6F4EF]"
                : "border-[#E0E3E6]",
            )}
            placeholder="Search…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); pushSearch(""); }}
              className="absolute right-2.5 text-[11px] text-[#9CA3AF] hover:text-[#374151]"
            >
              ✕
            </button>
          )}
        </form>

        {/* Actions */}
        {actions && (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        )}

        {/* Utility icons */}
        <div className="flex items-center gap-1">
          <NotificationsPopover />
          <ThemeToggle />
        </div>
      </div>

      {/* ── Mobile nav (small screens only) ───────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto border-t border-[#E5E7EB] px-4 pb-2 pt-1.5 lg:hidden">
        {visibleMobileNavigation.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={`${item.href}${currentQuery ? `?${currentQuery}` : ""}` as Route}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium whitespace-nowrap transition-all",
                active
                  ? "border-[#9CCFBB] bg-[#E6F4EF] text-[#006B45]"
                  : "border-[#E0E3E6] bg-white text-[#4B5563] hover:bg-[#F3F4F5]",
              )}
            >
              <Icon className="h-3 w-3" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}
