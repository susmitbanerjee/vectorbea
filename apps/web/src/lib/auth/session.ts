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
