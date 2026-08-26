"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Route } from "next";
import { Button } from "~/components/ui/button";
import { useSessionHint } from "~/lib/auth/session";

/* ══════════════════════════════════════════════════════════════════════════════
   THE ONLY PART OF THE LANDING PAGE THAT DEPENDS ON WHO IS READING IT.

   Anonymous, this is "Sign in" and "Start free" — unchanged, and it is what the
   server prerenders, so the first landing is the same page it has always been.
   Nothing else on the page varies: the hero and the closing band still say
   "Start free" to everybody, because a signed-in reader following one of those
   is sent into the app by /signup anyway.

   Signed in, the pair collapses to the account avatar with a menu. The reason
   that reads better is that it answers a different question: "Sign in" asks you
   to authenticate, while the avatar says the product already knows who you are
   and offers the one thing you came for, which is the way in.

   WHY THIS IS ITS OWN FILE, when the rest of the landing is one module.
   `landing.tsx` is a ~750-line SERVER component; this needs hooks, and
   `"use client"` is per-module, not per-component. Marking the whole landing
   client-side would ship nine sections, the comparison table and the icon set to
   the browser to change one corner of the nav.
══════════════════════════════════════════════════════════════════════════════ */

const APP_HOME = "/control";

/**
 * The menu is fetched only once there is somebody to show it to.
 *
 * It carries Radix DropdownMenu and the shared overlay styles — about 47 kB,
 * which is a third again of this page's entire first load, for a control an
 * anonymous visitor never sees. `ssr: false` because the identity behind it
 * cannot exist during a prerender anyway.
 */
const AccountMenu = dynamic(
  () => import("./account-menu").then((module) => module.AccountMenu),
  { ssr: false },
);

/** What `GET /api/auth/session` answers with when there is a session. */
export interface SessionIdentity {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  /** Where this account's post-login landing is — workspace-scoped. */
  redirectTo: string;
}

/**
 * The signed-in reader's identity, or null.
 *
 * TWO STEPS, AND THE ORDER IS THE POINT. `useSessionHint` is a cookie read: it
 * costs nothing and is false for almost every visitor to this page, so the fetch
 * below never happens for them. Only a hinted visitor pays a request.
 *
 * `/api/auth/session` rather than `/api/auth/token`: it returns the display
 * fields an avatar needs — name, email, picture — and the account's own landing
 * path, and unlike the token endpoint it is not in the middleware's
 * AUTH_RATE_PATHS, so reading it here cannot eat into the budget protecting real
 * sign-ins.
 *
 * A 401 means the hint outlived the session. Returning null falls the nav back
 * to Sign in / Start free, which is both correct and self-healing: that same
 * request went through the middleware, which cleared the stale hint on its way
 * past.
 */
function useSessionIdentity(): { identity: SessionIdentity | null; resolving: boolean } {
  const hinted = useSessionHint();
  const [identity, setIdentity] = React.useState<SessionIdentity | null>(null);
  const [resolving, setResolving] = React.useState(false);

  React.useEffect(() => {
    if (!hinted) {
      setIdentity(null);
      return;
    }

    let live = true;
    setResolving(true);

    void fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          body: {
            authenticated?: boolean;
            redirectTo?: string;
            user?: { email?: string; fullName?: string | null; avatarUrl?: string | null };
          } | null,
        ) => {
          if (!live) return;
          if (!body?.authenticated || !body.user?.email) {
            setIdentity(null);
            return;
          }
          setIdentity({
            email: body.user.email,
            fullName: body.user.fullName ?? null,
            avatarUrl: body.user.avatarUrl ?? null,
            // Never trust it off-site: this becomes an href. `//host` is
            // protocol-relative and would leave the site.
            redirectTo:
              body.redirectTo?.startsWith("/") && !body.redirectTo.startsWith("//")
                ? body.redirectTo
                : APP_HOME,
          });
        },
      )
      .catch(() => {
        // Offline, or the route is unreachable. The anonymous nav still works,
        // and /signin will sort out a session that does exist.
        if (live) setIdentity(null);
      })
      .finally(() => {
        if (live) setResolving(false);
      });

    return () => {
      live = false;
    };
  }, [hinted]);

  return { identity, resolving };
}

/**
 * The nav pair, top right of the hero.
 *
 * The anonymous branch renders on the server and is what crawlers and first
 * paint get. The signed-in branch can only arrive after mount — a prerendered
 * page has one HTML for everybody — so the swap is inherent, not a delay that
 * could be optimised away.
 */
export function MarketingNavCta() {
  const { identity, resolving } = useSessionIdentity();

  if (identity) return <AccountMenu identity={identity} />;

  return (
    <>
      <Button asChild size="sm" variant="secondary">
        <Link href={"/signin" as Route}>Sign in</Link>
      </Button>
      <Button asChild size="sm" variant="primary">
        <Link href={"/signup" as Route}>Start free</Link>
      </Button>
      {/* While the identity is in flight the anonymous pair stays put rather
          than collapsing to a placeholder — the nav must not shift twice. */}
      {resolving ? (
        <span className="sr-only" role="status">Checking your session…</span>
      ) : null}
    </>
  );
}
