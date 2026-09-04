import "server-only";

import { cookies } from "next/headers";
import { dehydrate, type DehydratedState, type QueryClient, type QueryKey } from "@tanstack/react-query";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { createVectorbeaClient, type VectorbeaClient } from "./client";
import { createServerQueryClient } from "./query-client";
import type { Session } from "~/lib/auth/session";

/**
 * Server-side API access and prefetching.
 *
 * This is the payoff for choosing cookie sessions over localStorage: a Server
 * Component can read the session, fetch the page's data during the render, and
 * ship it down already populated. The client hydrates into a warm cache instead
 * of mounting, discovering it has nothing, and painting a spinner.
 *
 * The token source here reads the cookie directly rather than calling
 * `/api/auth/token` — the server already has the cookie jar, and an internal
 * HTTP round-trip to our own origin would be a pointless hop. `forceRefresh` is
 * a no-op for the same reason: there is no second place to look. A rejected
 * token during SSR simply renders the signed-out state.
 */
export async function getServerApiClient(): Promise<VectorbeaClient> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;

  return createVectorbeaClient({
    getToken: async () => token,
  });
}

/** The session as the server sees it, for seeding `<SessionProvider>`. */
export async function getServerSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
  if (!token) return null;

  const { verifyToken } = await import("@/lib/auth/jwt");
  const payload = await verifyToken(token);
  if (!payload) return null;

  const { decodeJwt } = await import("jose");
  let expiresAt: number | null = null;
  try {
    const { exp } = decodeJwt(token);
    expiresAt = typeof exp === "number" ? exp * 1000 : null;
  } catch {
    expiresAt = null;
  }

  return { token, expiresAt, user: { id: payload.sub, email: payload.email } };
}

export interface PrefetchSpec<T> {
  queryKey: QueryKey;
  queryFn: (client: VectorbeaClient) => Promise<T>;
  staleTime?: number;
}

/**
 * Prefetch a page's queries and return the state to hand to `<HydrationBoundary>`.
 *
 * Failures are swallowed on purpose. A prefetch is an optimisation: if the API
 * is down or the user cannot see one of the resources, the page should still
 * render and let the client-side query surface the real error through the
 * taxonomy — with its retry, its request id, and its proper error state. A
 * throwing prefetch would replace all of that with a blank 500.
 */
export async function prefetchQueries(
  specs: PrefetchSpec<unknown>[],
): Promise<{ state: DehydratedState; queryClient: QueryClient }> {
  const queryClient = createServerQueryClient();
  const client = await getServerApiClient();

  await Promise.all(
    specs.map((spec) =>
      queryClient
        .prefetchQuery({
          queryKey: spec.queryKey,
          queryFn: () => spec.queryFn(client),
          staleTime: spec.staleTime,
        })
        .catch(() => undefined),
    ),
  );

  return { state: dehydrate(queryClient), queryClient };
}
