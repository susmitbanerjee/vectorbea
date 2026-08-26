"use client";

import Link from "next/link";
import type { Route } from "next";
import { Button, type ButtonSize } from "~/components/ui/button";
import { useSessionHint } from "~/lib/auth/session";

/* ══════════════════════════════════════════════════════════════════════════════
   THE ONLY PART OF THE LANDING PAGE THAT DEPENDS ON WHO IS READING IT.

   The landing page offered "Sign in" and "Start free" to everybody, including
   people who had been signed in for a week. Following either one worked — both
   routes now redirect a live session into the app — but being asked to sign in
   to a product you are already signed in to reads as "it forgot me", and that is
   the whole complaint.

   WHY THIS IS ITS OWN FILE, when the rest of the landing is one module.
   `landing.tsx` is a ~750-line SERVER component; the visitor-dependent bit needs
   a hook, and `"use client"` is per-module, not per-component. Marking the whole
   landing client-side would ship every one of those lines — nine sections, the
   comparison table, the icon set — to the browser as interactive JS to change
   two button labels. Isolating the three buttons keeps the page a server
   component and the client bundle at roughly nothing.

   The signed-out markup is what renders on the server, so it is what crawlers
   and first paint get. That is correct for almost every visitor to this page,
   and the swap for the rest happens on mount. See `useSessionHint` for why the
   answer cannot arrive any earlier on a statically prerendered page.
══════════════════════════════════════════════════════════════════════════════ */

const APP_HOME = "/control" as Route;

/**
 * The nav pair, top right of the hero.
 *
 * Signed in collapses to ONE button rather than relabelling both: "Sign in" and
 * "Start free" are two ways to say the same thing to somebody who has an
 * account, and offering both would be the same forgetfulness in gentler words.
 */
export function MarketingNavCta() {
  const signedIn = useSessionHint();

  if (signedIn) {
    return (
      <Button asChild size="sm" variant="primary">
        <Link href={APP_HOME}>Go to the app</Link>
      </Button>
    );
  }

  return (
    <>
      <Button asChild size="sm" variant="secondary">
        <Link href={"/signin" as Route}>Sign in</Link>
      </Button>
      <Button asChild size="sm" variant="primary">
        <Link href={"/signup" as Route}>Start free</Link>
      </Button>
    </>
  );
}

/**
 * The page's primary call to action — the hero, and the closing band.
 *
 * `label` is the signed-OUT wording, which differs between the two ("Start
 * free" in the hero, whatever the closing band asks for). The signed-in wording
 * does not: there is one app and one way in, and varying how it is named would
 * make the same destination look like two.
 */
export function MarketingPrimaryCta({
  label,
  size = "lg",
}: {
  label: string;
  size?: ButtonSize;
}) {
  const signedIn = useSessionHint();

  return (
    <Button asChild size={size} variant="primary">
      <Link href={signedIn ? APP_HOME : ("/signup" as Route)}>
        {signedIn ? "Open the app" : label}
      </Link>
    </Button>
  );
}
