"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";

/* ══════════════════════════════════════════════════════════════════════════════
   SETTINGS NAVIGATION

   Settings used to be a hub page whose only job was linking to six others, so
   every move between two settings screens went through it. The sections are
   peers; they get a persistent nav and the hub page becomes one of them
   (General) rather than a lobby.

   THE LIST IS NOT ROLE-FILTERED. A viewer can open General and see the
   workspace name with the rename disabled and the reason attached — which
   teaches the rule. Hiding the section instead teaches nothing, and makes
   "where do I change the name" unanswerable for the person who has to ask an
   admin to do it.
══════════════════════════════════════════════════════════════════════════════ */

interface Section {
  href: Route;
  label: string;
  /** Matches this href and everything under it. */
  prefix?: string;
}

/*
 * The audit log is deliberately absent. It is a record you go and read, not a
 * thing you configure, and it keeps its own top-level place in the sidebar —
 * listing it here too would give it two front doors and highlight neither
 * correctly.
 */
const SECTIONS: Section[] = [
  { href: "/settings" as Route, label: "General" },
  { href: "/settings/profile" as Route, label: "Profile" },
  { href: "/settings/members" as Route, label: "Members" },
  { href: "/settings/billing" as Route, label: "Plan & access" },
  { href: "/settings/usage" as Route, label: "Usage & limits" },
  { href: "/settings/sdk" as Route, label: "SDK & ingest" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="border-subtle mb-5 border-b">
      <ul className="-mb-px flex flex-wrap items-center gap-x-1">
        {SECTIONS.map((section) => {
          // `/settings` must not light up for `/settings/profile`, so the root
          // matches exactly while the others match their subtree.
          const active =
            section.href === "/settings"
              ? pathname === "/settings"
              : pathname === section.href || pathname.startsWith(`${section.href}/`);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-center border-b-2 px-2.5 py-2",
                  "transition-colors duration-fast ease-standard",
                  "outline-none focus-visible:focus-ring rounded-t-sm",
                  active
                    ? "border-accent"
                    : "hover:border-strong border-transparent",
                )}
              >
                <Text
                  variant="body-sm"
                  tone={active ? "max" : "muted"}
                  className={cn(active && "font-medium")}
                >
                  {section.label}
                </Text>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
