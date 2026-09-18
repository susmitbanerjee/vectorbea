"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTheme } from "next-themes";
import { cn } from "~/lib/cn";
import { Tooltip } from "~/components/ui/tooltip";
import { Kbd } from "~/components/ui/kbd";
import { overlaySurface, overlayMotion, menuItem } from "~/components/ui/select";
import { useSession } from "~/lib/auth/session-provider";
import { useEntitlements } from "~/lib/entitlements/use-entitlements";
import { PlanChip, PlanRing, planTier } from "~/components/ui/plan-badge";
import { NAV, type NavItem } from "./nav";
import { CountRoll } from "./count-roll";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { Wordmark } from "./wordmark";
import type { ShellCounts, Workspace } from "~/mocks/shell";

/* ══════════════════════════════════════════════════════════════════════════════
   SIDEBAR — 248px expanded, 56px collapsed (design §8).

   It is part of the PERSISTENT SHELL: mounted once, never re-animated on route
   change (§7.3). Nothing in here has an entrance animation — only the active
   indicator moves, and only because it is reporting a change.

   Collapsed mode keeps the group dividers. Dropping them saves 24px and costs
   the operator the entire mental model of the IA, which is a bad trade.
══════════════════════════════════════════════════════════════════════════════ */

const BADGE_TONE = {
  waiting: "bg-status-waiting-subtle text-status-waiting border-status-waiting-border",
  failed: "bg-status-failed-subtle text-status-failed border-status-failed-border",
  neutral: "bg-surface-active text-fg-secondary border-subtle",
} as const;

function NavBadge({ count, tone }: { count: number; tone: keyof typeof BADGE_TONE }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full border px-1",
        "font-code text-[10px] leading-none",
        BADGE_TONE[tone],
      )}
    >
      <CountRoll value={count} />
    </span>
  );
}

function NavLink({
  item, collapsed, counts, onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  counts: ShellCounts;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // Exact match, or a child route — but "/settings" must not light up for
  // "/settings/usage", which is its own nav item.
  const isExact = pathname === item.href;
  const isChild =
    pathname.startsWith(`${item.href}/`) &&
    !NAV.flatMap((g) => g.items).some((o) => o !== item && pathname.startsWith(o.href as string) && (o.href as string).length > (item.href as string).length);
  const active = isExact || isChild;

  const count = item.badge ? counts[item.badge] : 0;
  const Glyph = item.icon;

  return (
    <Tooltip
      disabled={!collapsed}
      side="right"
      content={item.label}
      shortcut={count > 0 ? `${count}` : undefined}
    >
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-2.5 rounded-sm px-2 py-1.5",
          "font-ui text-body-sm",
          "transition-colors duration-fast outline-none",
          "focus-visible:focus-ring",
          active
            ? "bg-surface-active text-fg-max font-medium"
            : "text-fg-secondary hover:bg-surface-hover hover:text-fg-primary",
          collapsed && "justify-center px-0",
        )}
      >
        {/* Active rail — brand, 2px, inset. Selection is a brand act (§3.3). */}
        {active ? (
          <span aria-hidden="true" className="bg-accent absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full" />
        ) : null}

        <Glyph size={16} weight={active ? "bold" : "regular"} aria-hidden="true" className="shrink-0" />

        {collapsed ? (
          count > 0 ? (
            // Collapsed: a dot, not a number — 56px has no room for a count,
            // and the tooltip carries the exact figure.
            <span
              className={cn(
                "absolute right-1.5 top-1.5 size-1.5 rounded-full",
                item.badgeTone === "failed" ? "bg-status-failed" : "bg-status-waiting",
              )}
            />
          ) : null
        ) : (
          <>
            <span className="truncate">{item.label}</span>
            {item.badge ? <NavBadge count={count} tone={item.badgeTone ?? "neutral"} /> : null}
          </>
        )}
      </Link>
    </Tooltip>
  );
}

export interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  workspace: Workspace;
  workspaces: Workspace[];
  onWorkspaceChange: (id: string) => void;
  counts: ShellCounts;
  user?: { name: string; email: string; avatarUrl?: string | null } | null;
  onOpenShortcuts: () => void;
  /** Called after any nav click — closes the mobile drawer. */
  onNavigate?: () => void;
}

export function Sidebar({
  collapsed, onToggleCollapsed, workspace, workspaces, onWorkspaceChange, counts, user,
  onOpenShortcuts, onNavigate,
}: SidebarProps) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        "bg-surface-base border-subtle flex h-full flex-col border-r",
        // Width is a transition on a CSS variable, not a layout animation —
        // the content inside does not re-mount.
        "transition-[width] duration-base ease-standard",
        collapsed ? "w-[var(--sidebar-collapsed)]" : "w-[var(--sidebar-expanded)]",
      )}
    >
      <div className={cn("flex items-center gap-2 px-3 py-3", collapsed && "justify-center px-0")}>
        <Wordmark collapsed={collapsed} />
      </div>

      <div className={cn("px-2 pb-2", collapsed && "px-1.5")}>
        <WorkspaceSwitcher
          workspace={workspace}
          workspaces={workspaces}
          onWorkspaceChange={onWorkspaceChange}
          collapsed={collapsed}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {NAV.map((group, i) => (
          <div key={group.id} className={cn(i > 0 && "mt-4")}>
            {collapsed ? (
              // Divider preserves the grouping without the label.
              i > 0 ? <div className="border-subtle mx-2 mb-2 border-t" aria-hidden="true" /> : null
            ) : (
              <p className="font-ui text-eyebrow text-fg-muted px-2 pb-1 uppercase">{group.label}</p>
            )}
            <div className="grid gap-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} collapsed={collapsed} counts={counts} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={cn("border-subtle grid gap-0.5 border-t p-2", collapsed && "px-1.5")}>
        <FooterLink href="/docs" label="Docs" collapsed={collapsed} onNavigate={onNavigate} />
        <ThemeToggle collapsed={collapsed} />
        <UserMenu user={user} collapsed={collapsed} onOpenShortcuts={onOpenShortcuts} />
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex items-center gap-2.5 rounded-sm px-2 py-1.5",
            "font-ui text-body-sm text-fg-muted",
            "transition-colors duration-fast outline-none",
            "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
            collapsed && "justify-center px-0",
          )}
        >
          <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <path d={collapsed ? "M6.5 3v10" : "M6.5 3v10"} stroke="currentColor" strokeWidth="1.4" />
          </svg>
          {collapsed ? null : (
            <>
              <span>Collapse</span>
              <Kbd keys="mod+\" className="ml-auto" />
            </>
          )}
        </button>
      </div>
    </nav>
  );
}

function FooterLink({
  href, label, collapsed, onNavigate,
}: { href: string; label: string; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <Tooltip disabled={!collapsed} side="right" content={label}>
      <Link
        href={href as never}
        onClick={onNavigate}
        /* The docs render outside the (app) route group, so following this link
           in place unmounts the whole shell. A new tab keeps the workspace, the
           canvas and any unsaved state where they were. */
        target="_blank"
        rel="noreferrer"
        className={cn(
          "flex items-center gap-2.5 rounded-sm px-2 py-1.5",
          "font-ui text-body-sm text-fg-muted",
          "transition-colors duration-fast outline-none",
          "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
          collapsed && "justify-center px-0",
        )}
      >
        <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" aria-hidden="true">
          <path d="M3 3.5h4a2 2 0 0 1 2 2v7a1.5 1.5 0 0 0-1.5-1.5H3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M13 3.5H9a2 2 0 0 0-2 2v7a1.5 1.5 0 0 1 1.5-1.5H13Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
        {collapsed ? null : <span>{label}</span>}
      </Link>
    </Tooltip>
  );
}

function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const next = resolvedTheme === "dark" ? "light" : "dark";
  const label = !mounted ? "Theme" : `Switch to ${next} theme`;

  return (
    <Tooltip disabled={!collapsed} side="right" content={label}>
      <button
        type="button"
        onClick={() => setTheme(next)}
        aria-label={label}
        className={cn(
          "flex items-center gap-2.5 rounded-sm px-2 py-1.5",
          "font-ui text-body-sm text-fg-muted",
          "transition-colors duration-fast outline-none",
          "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
          collapsed && "justify-center px-0",
        )}
      >
        <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1"
            stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {collapsed ? null : (
          <>
            <span>Theme</span>
            <span className="font-ui text-caption text-fg-disabled ml-auto capitalize">
              {mounted ? (theme === "system" ? "System" : theme) : ""}
            </span>
          </>
        )}
      </button>
    </Tooltip>
  );
}

function UserMenu({
  user, collapsed, onOpenShortcuts,
}: {
  user?: { name: string; email: string; avatarUrl?: string | null } | null;
  collapsed: boolean;
  onOpenShortcuts: () => void;
}) {
  const name = user?.name ?? "Signed out";
  const email = user?.email ?? "";
  const avatarUrl = user?.avatarUrl;

  /*
   * ── THE PLAN ON THE ACCOUNT ROW ──────────────────────────────────────────
   *
   * The ring and the chip say what THIS WORKSPACE's billing account is on, not
   * what the person signed in is on — those are different questions and only
   * the first one matches what the API will enforce (invariant 11). Switching
   * workspaces changes the ring, which is the correct and useful behaviour: it
   * is the same fact every gate in the product is about to use.
   *
   * Free resolves to no tier and draws nothing, so does an answer that has not
   * arrived. There is no skeleton here on purpose — a placeholder pill that
   * resolves to nothing for most accounts is a worse first paint than a chip
   * that appears once, and the chip is a decoration, not information the screen
   * is incomplete without.
   */
  const { planCode, planName, upgradeTo } = useEntitlements();
  const tier = planTier(planCode);
  const planLabel = planName || tier?.fallbackLabel || null;

  /*
   * ── SIGN OUT WAS A LINK TO THE SIGN-IN PAGE ──────────────────────────────
   *
   * `<Link href="/signin">Sign out</Link>`. It navigated. It cleared nothing —
   * not the httpOnly cookie, not the in-memory token, not the localStorage copy
   * the legacy layer keeps. The session survived every "sign out" in the
   * product, and once /signin started redirecting a live session onward the
   * button became visibly inert: click it, land back in the app.
   *
   * `useSession().signOut()` is the one implementation: it DELETEs the session
   * cookie server-side, tears down the client caches, and lands on the marketing
   * page.
   */
  const { signOut } = useSession();
  const [signingOut, setSigningOut] = React.useState(false);

  return (
    <DropdownMenu.Root>
      <Tooltip
        disabled={!collapsed}
        side="right"
        content={name}
        shortcut={planLabel ?? undefined}
      >
        <DropdownMenu.Trigger
          className={cn(
            "flex items-center gap-2.5 rounded-sm px-2 py-1.5",
            "font-ui text-body-sm text-fg-secondary",
            "transition-colors duration-fast outline-none",
            "hover:bg-surface-hover hover:text-fg-primary focus-visible:focus-ring",
            collapsed && "justify-center px-0",
          )}
          /* The plan belongs in the accessible name, not only in the ring —
             colour is never the only carrier of a fact (design §14), and a ring
             is colour and nothing else. */
          aria-label={planLabel ? `Account: ${name}, ${planLabel} plan` : `Account: ${name}`}
        >
          <PlanRing tier={tier}>
            <UserAvatar url={avatarUrl} name={name} size="sm" />
          </PlanRing>
          {collapsed ? null : (
            <>
              <span className="truncate">{name}</span>
              <PlanChip tier={tier} name={planName} className="ml-auto" />
            </>
          )}
        </DropdownMenu.Trigger>
      </Tooltip>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={6}
          className={cn(overlaySurface, overlayMotion, "z-popover w-64 p-1")}
        >
          {email ? (
            <div className="border-subtle mb-1 flex items-center gap-2.5 border-b px-2 pb-2 pt-1">
              <PlanRing tier={tier}>
                <UserAvatar url={avatarUrl} name={name} size="md" />
              </PlanRing>
              <div className="min-w-0">
                <p className="font-ui text-body-sm text-fg-primary truncate">{name}</p>
                <p className="font-ui text-caption text-fg-muted truncate">{email}</p>
              </div>
            </div>
          ) : null}

          {/* What the WORKSPACE is on. Named as such, because the row above it
              is the person and the two are different subjects — a Pro
              subscriber inside a Free workspace is held to Free, and this line
              is the only place the product can say so before a gate does. */}
          {planLabel ? (
            <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
              <span className="font-ui text-caption text-fg-muted shrink-0">Workspace plan</span>
              {tier ? (
                <PlanChip tier={tier} name={planName} className="ml-auto" />
              ) : (
                // Free still gets its name here — this row is a statement of
                // fact, not the decoration. It is the ring and the chip that
                // Free deliberately has none of.
                <span className="font-ui text-caption text-fg-secondary ml-auto truncate">
                  {planLabel}
                </span>
              )}
            </div>
          ) : null}

          {/* Only when the catalogue says there is somewhere to go. Enterprise
              is the top plan and gets no upsell, which is the point of reading
              this from the plan row rather than from a list written here.

              The link is the in-product plan page rather than the plan's own
              `upgradeUrl`: that field is data, a typed route is not, and the
              screen it would skip is where the upgrade is actually filed. */}
          {upgradeTo ? (
            <DropdownMenu.Item className={menuItem} asChild>
              <Link href={"/settings/billing" as never}>Upgrade to {upgradeTo.name}</Link>
            </DropdownMenu.Item>
          ) : null}

          <DropdownMenu.Item className={menuItem} asChild>
            <Link href={"/settings/profile" as never}>Profile</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} onSelect={() => onOpenShortcuts()}>
            Keyboard shortcuts
            <Kbd keys="?" className="ml-auto" />
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="bg-surface-active my-1 h-px" />
          <DropdownMenu.Item
            className={cn(menuItem, "text-status-failed data-[highlighted]:text-status-failed")}
            disabled={signingOut}
            /* `onSelect` rather than `onClick`: Radix closes the menu on select,
               and an async handler on a click would race that unmount. */
            onSelect={() => {
              setSigningOut(true);
              void signOut().finally(() => setSigningOut(false));
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * The account picture, with the letter it falls back to.
 *
 * ── IT USED TO RENDER NOTHING ────────────────────────────────────────────────
 * The trigger was `{avatarUrl ? <img/> : null}`, so an account with no picture —
 * and a collapsed sidebar — had an EMPTY 56px button as its only way into
 * Profile and Sign out. It was invisible, and it was the whole account menu.
 *
 * That also decides this component's shape: the plan ring is drawn around the
 * avatar, so an avatar that is sometimes absent is a ring that is sometimes
 * absent, and the tier would silently stop being visible for exactly the
 * accounts that never uploaded a photo. A fallback is not a nicety here; it is
 * what makes the feature above it true for everybody.
 *
 * `onError` matters for the same reason: a provider URL that 404s (a rotated
 * Google photo, a deleted Slack avatar) leaves a broken-image glyph inside a
 * gold ring, which looks like a rendering failure rather than a missing file.
 */
function UserAvatar({
  url, name, size,
}: {
  url?: string | null;
  name: string;
  size: "sm" | "md";
}) {
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => { setBroken(false); }, [url]);

  const box = size === "sm" ? "size-5" : "size-8";

  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external provider avatar, not a local asset
      <img
        src={url}
        alt=""
        onError={() => setBroken(true)}
        className={cn(box, "shrink-0 rounded-full object-cover")}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        "bg-accent-subtle text-accent grid shrink-0 place-items-center rounded-full",
        "font-ui",
        size === "sm" ? "text-eyebrow" : "text-label",
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
