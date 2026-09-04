"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

import { cn } from "~/lib/cn";
import { Text } from "~/components/ui/text";
import { useWorkspaceRole } from "~/lib/workspace/workspace-provider";

/* ══════════════════════════════════════════════════════════════════════════════
   SETTINGS NAVIGATION

   Settings used to be a hub page whose only job was linking to six others, so
   every move between two settings screens went through it. The sections are
   peers; they get a persistent nav and the hub page becomes one of them
   (General) rather than a lobby.

   WORKSPACE SECTIONS ARE ROLE-FILTERED; PROFILE IS NOT. Everything except
   Profile configures the workspace, and the API refuses those writes below
   admin — so listing them for a developer or viewer offers four doors that all
   end in 403. Profile stays, because it is theirs.

   This is presentation only. `assertWorkspaceMember` + `requireWorkspaceRole`
   on every settings route is the enforcement; nothing here is a boundary.
══════════════════════════════════════════════════════════════════════════════ */

interface Section {
  href: Route;
  label: string;
  /**
   * True for sections that belong to the PERSON rather than the workspace.
   *
   * Personal sections are reachable at every role; workspace sections need
   * admin or owner. A developer who cannot rename the workspace can still
   * change their own name and password.
   */
  personal?: boolean;
}

/*
 * The audit log is deliberately absent. It is a record you go and read, not a
 * thing you configure, and it keeps its own top-level place in the sidebar —
 * listing it here too would give it two front doors and highlight neither
 * correctly.
 *
 * SDK & ingest is gone: it belongs to the previous stack (the LLM-proxy ingest
 * tokens), not to this one.
 */
const SECTIONS: Section[] = [
  // Profile first, because it is the only section every role can reach.
  { href: "/settings/profile" as Route, label: "Profile", personal: true },
  { href: "/settings" as Route, label: "General" },
  { href: "/settings/members" as Route, label: "Members" },
  { href: "/settings/billing" as Route, label: "Plan & access" },
  { href: "/settings/usage" as Route, label: "Usage & limits" },
];

export function SettingsNav() {
  const pathname = usePathname();
  const { canAdminister, resolving } = useWorkspaceRole();

  // While the role is still resolving, show everything rather than flashing a
  // one-item nav at an owner on every page load. The pages behind it render
  // their own permission-denied state if it turns out they cannot be read.
  const sections = SECTIONS.filter((section) => section.personal || canAdminister || resolving);

  return (
    <nav aria-label="Settings sections" className="border-subtle mb-5 border-b">
      <ul className="-mb-px flex flex-wrap items-center gap-x-1">
        {sections.map((section) => {
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
