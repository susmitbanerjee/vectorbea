"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import {
  clearAccessToken,
  getAccessToken,
  primeAccessToken,
  type AccessToken,
} from "./token";
import {
  signOutRequest,
  type Session,
  type SessionUser,
} from "./session";

export interface SessionState {
  user: SessionUser | null;
  session: Session | null;
  loading: boolean;
  error: Error | null;
  signOut(): Promise<void>;
  /** Force a token fetch. Returns null when there is no session. */
  refresh(): Promise<Session | null>;
}

const SessionContext = React.createContext<SessionState | null>(null);

export interface SessionProviderProps {
  children: React.ReactNode;
  /**
   * Server-rendered session, if the layout already resolved one. Seeding this
   * avoids a token fetch on first paint and the loading flash that comes with
   * it — the reason the session is a cookie rather than localStorage.
   */
  initialSession?: Session | null;
}

export function SessionProvider({ children, initialSession = null }: SessionProviderProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Seed the module-level token cache synchronously on first render so the very
  // first API call does not race the effect below.
  const primed = React.useRef(false);
  if (!primed.current) {
    primed.current = true;
    if (initialSession) primeAccessToken(initialSession as AccessToken);
  }

  const [session, setSession] = React.useState<Session | null>(initialSession);
  const [loading, setLoading] = React.useState(initialSession === null);
  const [error, setError] = React.useState<Error | null>(null);

  const load = React.useCallback(async (forceRefresh = false): Promise<Session | null> => {
    try {
      const token = await getAccessToken({ forceRefresh });
      setSession(token);
      setError(null);
      return token;
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Resolve the session on mount when the server did not supply one.
  React.useEffect(() => {
    if (initialSession) return;
    void load();
  }, [initialSession, load]);

  /**
   * Pre-emptive refresh.
   *
   * Scheduled one minute before expiry rather than waiting for a 401, so a user
   * reading a page for an hour does not see a request fail and retry. The
   * single-flight guard in `getAccessToken` means this cannot collide with a
   * reactive refresh triggered by the transport.
   */
  React.useEffect(() => {
    if (!session?.expiresAt) return;

    const leadMs = 60_000;
    const delay = Math.max(0, session.expiresAt - Date.now() - leadMs);
    // setTimeout clamps above ~24.8 days; cap so the timer stays meaningful.
    const timer = setTimeout(() => void load(true), Math.min(delay, 2 ** 31 - 1));

    return () => clearTimeout(timer);
  }, [session?.expiresAt, load]);

  const teardown = React.useCallback(() => {
    clearAccessToken();
    /*
     * The LEGACY token too.
     *
     * Two auth layers coexist: this one keeps the token in module memory, and
     * `@/lib/api/client` keeps a copy in localStorage for the Kotlin API's
     * Authorization header. Clearing only the first left the second behind, so
     * the departing user's JWT stayed in the browser and the next request from
     * the legacy layer still carried it.
     */
    try { window.localStorage.removeItem("vectorbea-access-token"); } catch { /* storage blocked */ }
    setSession(null);
    // Every cached query was fetched as the departing user. Removing rather
    // than invalidating means nothing is served from cache to whoever signs in
    // next, even for a frame.
    queryClient.clear();
  }, [queryClient]);

  const signOut = React.useCallback(async () => {
    await signOutRequest();
    teardown();
    /*
     * The LANDING page, not the sign-in form.
     *
     * Signing out and being dropped on a sign-in form reads as a failed
     * sign-out — the product is asking for the credential you just withdrew. It
     * is also a loop now that /signin redirects a live session onward: a
     * sign-out that failed to clear the cookie would bounce straight back into
     * the app, which is exactly how the broken one behaved.
     *
     * `router.refresh()` is not optional. Every (app) page is `force-dynamic`
     * and server-rendered against the cookie; without it the client cache would
     * keep serving the departed user's rendered tree behind the navigation.
     */
    router.replace("/");
    router.refresh();
  }, [router, teardown]);

  // The transport calls this when a refresh could not rescue a 401.
  React.useEffect(() => {
    const handler = () => {
      teardown();
      const next = window.location.pathname + window.location.search;
      router.replace(`/signin?next=${encodeURIComponent(next)}`);
    };
    sessionExpiredHandlers.add(handler);
    return () => {
      sessionExpiredHandlers.delete(handler);
    };
  }, [router, teardown]);

  const value = React.useMemo<SessionState>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      error,
      signOut,
      refresh: () => load(true),
    }),
    [session, loading, error, signOut, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * Handlers the transport fires on an unrecoverable 401.
 *
 * A module-level set rather than a prop or context read: the transport is
 * created outside React and cannot call a hook, and the alternative — having
 * every caller catch `unauthenticated` and redirect — is the duplication the
 * taxonomy exists to remove.
 */
const sessionExpiredHandlers = new Set<() => void>();

export function notifySessionExpired(): void {
  for (const handler of sessionExpiredHandlers) handler();
}

export function useSession(): SessionState {
  const context = React.useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside <SessionProvider>.");
  }
  return context;
}
