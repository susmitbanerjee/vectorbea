/**
 * Access-token provider with a single-flight refresh guard.
 *
 * The token lives in module memory and nowhere else — not localStorage, not a
 * readable cookie. A page reload re-fetches it from `/api/auth/token`, which
 * reads the httpOnly session cookie server-side.
 *
 * Single flight
 * ─────────────
 * Twenty concurrent requests hitting 401 at once must produce ONE refresh, not
 * twenty. `inflight` holds the promise for the fetch currently in progress;
 * every caller that arrives while it is pending awaits the same promise. This
 * also covers the pre-emptive refresh racing a reactive one.
 */

export interface AccessToken {
  token: string;
  /** Epoch ms, or null when the token carries no `exp`. */
  expiresAt: number | null;
  user: { id: string; email: string };
}

/** Refresh this far ahead of expiry rather than waiting for a 401. */
const REFRESH_SKEW_MS = 60_000;

const TOKEN_ENDPOINT = "/api/auth/token";

let current: AccessToken | null = null;
let inflight: Promise<AccessToken | null> | null = null;

/** Raised when the session is gone and the caller should be sent to sign-in. */
export class SessionExpiredError extends Error {
  constructor(message = "Your session has ended. Sign in to continue.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

function isFresh(token: AccessToken | null): token is AccessToken {
  if (!token) return false;
  if (token.expiresAt === null) return true;
  return token.expiresAt - Date.now() > REFRESH_SKEW_MS;
}

async function fetchToken(): Promise<AccessToken | null> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "GET",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (response.status === 401) return null;

  if (!response.ok) {
    throw new Error(`Could not read the session (HTTP ${response.status}).`);
  }

  const body = (await response.json()) as AccessToken;
  return body;
}

/**
 * The current access token, refreshing if it is missing, stale, or if the
 * caller saw a 401 and passed `forceRefresh`.
 *
 * Returns null when there is no session — callers should treat that as
 * unauthenticated rather than as an error.
 */
export async function getAccessToken(
  options: { forceRefresh?: boolean } = {},
): Promise<AccessToken | null> {
  if (!options.forceRefresh && isFresh(current)) return current;

  // Someone else is already refreshing — join them instead of piling on.
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const next = await fetchToken();
      current = next;
      return next;
    } finally {
      // Cleared in `finally` so a failed refresh does not wedge every future
      // caller onto a permanently rejected promise.
      inflight = null;
    }
  })();

  return inflight;
}

/** Seed the cache from a server-rendered value, avoiding a fetch on first paint. */
export function primeAccessToken(token: AccessToken | null): void {
  current = token;
}

/** Drop the in-memory token. Called on sign-out and on a hard 401. */
export function clearAccessToken(): void {
  current = null;
  inflight = null;
}

/** Read the cached token without triggering a fetch. */
export function peekAccessToken(): AccessToken | null {
  return current;
}
