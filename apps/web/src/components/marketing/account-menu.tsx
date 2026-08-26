"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "~/lib/cn";
import { Spinner } from "~/components/ui/spinner";
import { overlaySurface, overlayMotion, menuItem } from "~/components/ui/select";
import { signOutRequest } from "~/lib/auth/session";
import type { SessionIdentity } from "./session-cta";

/* ══════════════════════════════════════════════════════════════════════════════
   THE ACCOUNT MENU — and why it is a module of its own.

   PURELY A BUNDLE DECISION. Radix DropdownMenu plus the shared overlay styles
   are ~47 kB, and folding them into `session-cta.tsx` put every byte into the
   landing page's first load — for a control that only a signed-in visitor ever
   sees, on the one page whose weight matters most. Split out, `next/dynamic`
   fetches this chunk only after the session hint says there is somebody to show
   it to, and an anonymous reader downloads none of it.

   It is the same menu the app shell's sidebar renders, and deliberately so: the
   avatar means the same thing in both places, so it opens onto the same three
   choices.
══════════════════════════════════════════════════════════════════════════════ */

export function AccountMenu({ identity }: { identity: SessionIdentity }) {
  const [signingOut, setSigningOut] = React.useState(false);
  const name = identity.fullName?.trim() || identity.email;

  /*
   * Sign out from a page that has no SessionProvider.
   *
   * The marketing pages are outside the app's provider stack, so `signOut()`
   * from `useSession()` is unavailable here — but the work is the same and must
   * not diverge: DELETE the session cookie, drop the localStorage token the
   * legacy auth layer keeps, then leave.
   *
   * A full document navigation rather than `router.replace`. This page is
   * statically prerendered, so a client-side navigation to it would not re-run
   * the middleware — and the middleware is what clears the `vb_signed_in` hint.
   * Without the round trip the nav would go on showing this avatar after the
   * session had gone.
   */
  const signOut = () => {
    setSigningOut(true);
    void signOutRequest()
      .catch(() => {
        // The cookie expires on its own; leaving is still the right outcome.
      })
      .finally(() => {
        try { window.localStorage.removeItem("vectorbea-access-token"); } catch { /* storage blocked */ }
        window.location.assign("/");
      });
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={cn(
          "flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2.5",
          "font-ui text-body-sm text-fg-secondary",
          "border-subtle border bg-transparent",
          "transition-colors duration-fast outline-none",
          "hover:border-default hover:text-fg-primary",
          "focus-visible:focus-ring",
          "data-[state=open]:border-default data-[state=open]:text-fg-primary",
        )}
        aria-label={`Account: ${name}`}
      >
        <Avatar identity={identity} />
        <span className="hidden max-w-[12ch] truncate sm:inline">{name}</span>
        <Chevron />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className={cn(overlaySurface, overlayMotion, "z-popover w-60 p-1")}
        >
          <div className="border-subtle mb-1 flex items-center gap-2.5 border-b px-2 pb-2 pt-1.5">
            <Avatar identity={identity} size="lg" />
            <div className="min-w-0">
              <p className="font-ui text-body-sm text-fg-primary truncate">{name}</p>
              {identity.fullName ? (
                <p className="font-ui text-caption text-fg-muted truncate">{identity.email}</p>
              ) : null}
            </div>
          </div>

          {/* The thing they came for. `redirectTo` carries the workspace, so
              this is their Control page rather than a generic one. */}
          <DropdownMenu.Item className={menuItem} asChild>
            <Link href={identity.redirectTo as Route}>
              <ControlGlyph />
              Control
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItem} asChild>
            <Link href={"/settings/profile" as Route}>Account settings</Link>
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="bg-surface-active my-1 h-px" />

          <DropdownMenu.Item
            className={cn(menuItem, "text-status-failed data-[highlighted]:text-status-failed")}
            disabled={signingOut}
            /* `onSelect`, not `onClick`: Radix closes the menu on select, and an
               async handler hung off a click would race that unmount.
               `preventDefault` holds it open long enough to show the spinner. */
            onSelect={(event) => {
              event.preventDefault();
              signOut();
            }}
          >
            {signingOut ? <Spinner /> : null}
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * The avatar: the provider's picture when there is one, initials otherwise.
 *
 * Initials rather than a generic person glyph, because the point of showing an
 * avatar at all is to say WHICH account is signed in — on a shared machine a
 * neutral silhouette answers the question wrongly.
 */
function Avatar({ identity, size = "sm" }: { identity: SessionIdentity; size?: "sm" | "lg" }) {
  const source = identity.fullName?.trim() || identity.email;
  const initials =
    source
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const box = size === "lg" ? "size-8 text-body-sm" : "size-6 text-caption";

  if (identity.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external provider avatar, not a local asset
      <img
        src={identity.avatarUrl}
        alt=""
        className={cn(box, "shrink-0 rounded-full object-cover")}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        box,
        "bg-surface-active text-fg-secondary font-ui grid shrink-0 place-items-center rounded-full font-medium",
      )}
    >
      {initials}
    </span>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 10 10" className="size-2.5 shrink-0 opacity-60" aria-hidden="true" fill="none">
      <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ControlGlyph() {
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0" aria-hidden="true" fill="none">
      <path d="M2 2.5h4v4H2zM8 2.5h4v2H8zM8 6.5h4v5H8zM2 8.5h4v3H2z" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}
