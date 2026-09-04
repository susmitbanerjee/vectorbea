"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "~/lib/cn";
import { Kbd } from "~/components/ui/kbd";
import { MonoId } from "~/components/ui/mono-id";
import { segmentLabel, isIdSegment } from "./nav";
import { NotificationInbox } from "./notification-inbox";

/**
 * Breadcrumb derived from the route.
 *
 * Id segments render as <MonoId> — middle-truncated and click-to-copy — because
 * a run id in a breadcrumb is something operators copy into a ticket constantly,
 * and a 36-character UUID otherwise eats the whole bar.
 */
function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1">
        {segments.map((segment, i) => {
          const href = `/${segments.slice(0, i + 1).join("/")}`;
          const last = i === segments.length - 1;
          const isId = isIdSegment(segment);

          return (
            <li key={href} className="flex min-w-0 items-center gap-1">
              {i > 0 ? (
                <span className="text-fg-disabled shrink-0" aria-hidden="true">/</span>
              ) : null}

              {isId ? (
                <MonoId value={segment} head={6} tail={4} />
              ) : last ? (
                <span className="font-ui text-body-sm text-fg-primary truncate font-medium" aria-current="page">
                  {segmentLabel(segment)}
                </span>
              ) : (
                <Link
                  href={href as never}
                  className={cn(
                    "font-ui text-body-sm text-fg-muted truncate rounded-xs px-0.5",
                    "transition-colors duration-fast outline-none",
                    "hover:text-fg-primary focus-visible:focus-ring",
                  )}
                >
                  {segmentLabel(segment)}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface TopbarProps {
  onOpenPalette: () => void;
  /** Page-level actions, supplied by the route. */
  actions?: React.ReactNode;
  /** Opens the sidebar drawer below 1024px. */
  onOpenSidebar?: () => void;
}

export function Topbar({
  onOpenPalette, actions, onOpenSidebar,
}: TopbarProps) {
  return (
    <header
      className={cn(
        "bg-surface-base border-subtle sticky top-0 z-sticky",
        "flex h-12 shrink-0 items-center gap-2 border-b px-3",
      )}
    >
      {/* Drawer trigger — only below the sidebar breakpoint. */}
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-sm lg:hidden",
          "text-fg-secondary transition-colors duration-fast outline-none",
          "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
        )}
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <Breadcrumb />

      {/* Search trigger. Not an input: the palette IS the search surface, and a
          decorative input that does nothing on focus is a lie about affordance. */}
      <button
        type="button"
        onClick={onOpenPalette}
        className={cn(
          "hidden h-7 items-center gap-2 rounded-sm border px-2 sm:flex",
          "bg-surface-sunken border-default",
          "font-ui text-caption text-fg-muted",
          "transition-colors duration-fast outline-none",
          "hover:border-strong hover:text-fg-secondary focus-visible:focus-ring",
          "w-40 lg:w-56",
        )}
        aria-label="Search and commands"
      >
        <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
          <path d="m10.2 10.2 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="flex-1 text-left">Search…</span>
        <Kbd keys="mod+k" />
      </button>

      {/* Compact search on mobile. */}
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Search and commands"
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-sm sm:hidden",
          "text-fg-secondary transition-colors duration-fast outline-none",
          "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
        )}
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
          <path d="m10.2 10.2 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      <NotificationInbox />

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
