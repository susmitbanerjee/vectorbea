"use client";

import { useEffect, useState } from "react";

/**
 * Session shape, and the one call that ends a session.
 *
 * There is no call that STARTS one here any more. Sign-in is federated: the
 * browser leaves for GitHub, Google or Microsoft and comes back through
 * `/api/auth/callback`, which sets the httpOnly cookie itself. Nothing in the
 * client ever holds a credential, so there is nothing here to post.
 *
 * `/api/auth/session` is a same-origin Next route handler, NOT the Kotlin API,
 * so it deliberately does not go through the API transport.
 */

export interface SessionUser {
  id: string;
  email: string;
  fullName?: string | null;
  avatarUrl?: string | null;
}

export interface Session {
  token: string;
  /** Epoch ms, or null when the token carries no `exp`. */
  expiresAt: number | null;
  user: SessionUser;
}

/* ══════════════════════════════════════════════════════════════════════════════
   "IS THERE A SESSION?" — ON A PAGE THAT IS NOT THE APP

   `useSession()` answers this properly, but it lives under `SessionProvider`,
   which is mounted only inside the authenticated shell and resolves by calling
   `/api/auth/token`. Neither is available to the landing page or the docs: they
   are outside the provider, they are statically prerendered, and that endpoint is
   rate-limited at ten requests per IP per minute precisely because it is part of
   the sign-in path.

   So the public pages read the hint the middleware mirrors out of the httpOnly
   cookie (see `syncSessionHint` in middleware.ts). It is a boolean and nothing
   else — no identity, no token, no claim.

   NOTHING MAY AUTHORISE ON THIS. It decides a button's label and destination.
   Every real gate is server-side on the httpOnly cookie, and a visitor who forges
   the hint gets a link to /control that redirects them straight back to /signin.
══════════════════════════════════════════════════════════════════════════════ */

/** Written by the middleware. Keep in step with `SESSION_HINT_COOKIE` there. */
const SESSION_HINT_COOKIE = "vb_signed_in";

function readSessionHint(): boolean {
  try {
    return document.cookie
      .split(";")
      .some((entry) => entry.trim() === `${SESSION_HINT_COOKIE}=1`);
  } catch {
    // No document (SSR) or cookies blocked. Treat as signed out — the worst
    // outcome is a sign-in link that redirects a signed-in user onward, which
    // is where they were going anyway.
    return false;
  }
}

/**
 * True when the visitor has a session, for presentation on a public page.
 *
 * Resolved AFTER mount, deliberately. These pages are prerendered and the
 * prerendered HTML is the same for everyone, so the first paint has to be the
 * signed-out state — which is also the correct one for the overwhelming
 * majority of landing-page visitors and for every crawler. Reading the cookie
 * during render instead would be a hydration mismatch, not a faster answer.
 */
export function useSessionHint(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(readSessionHint()), []);
  return signedIn;
}

/** Clears the httpOnly session cookie server-side. */
export async function signOutRequest(): Promise<void> {
  await fetch("/api/auth/session", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).catch(() => {
    // A failed sign-out must not trap the user in the app. The client-side
    // teardown below still runs, and the cookie expires on its own.
  });
}
