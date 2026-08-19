/**
 * Session shape and the credential calls that establish one.
 *
 * These endpoints are same-origin Next route handlers, NOT the Kotlin API, so
 * they deliberately do not go through the API transport: there is no bearer
 * token to attach yet, and a 401 here means "wrong password", not "refresh the
 * session". Mixing the two would make the transport's 401 handler fire during
 * sign-in and try to refresh a session that does not exist.
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

/** A credential failure, carrying the status so the UI can map it to an intent. */
export class CredentialError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CredentialError";
    this.status = status;
  }
}

async function postCredentials(
  path: string,
  body: Record<string, unknown>,
): Promise<{ user: SessionUser }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CredentialError("Could not reach Vectorbea. Check your connection and try again.", 0);
  }

  const payload = (await response.json().catch(() => null)) as
    | { user?: SessionUser; error?: string }
    | null;

  if (!response.ok) {
    throw new CredentialError(
      payload?.error ?? `Sign-in failed (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (!payload?.user) {
    throw new CredentialError("The server accepted the request but returned no user.", 500);
  }

  return { user: payload.user };
}

export function signInWithPassword(email: string, password: string): Promise<{ user: SessionUser }> {
  return postCredentials("/api/auth/signin", { email, password });
}

export function signUpWithPassword(
  email: string,
  password: string,
  fullName?: string,
): Promise<{ user: SessionUser }> {
  return postCredentials("/api/auth/signup", { email, password, fullName });
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
