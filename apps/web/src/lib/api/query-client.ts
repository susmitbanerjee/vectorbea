import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

import { STALE_TIME } from "./keys";
import { isVectorbeaApiError } from "./errors";

/**
 * QueryClient defaults.
 *
 * The important decision here is that TanStack does NOT retry.
 *
 * The transport already retries the only failures worth retrying — 502/503/504
 * and network faults — with jittered backoff, and it already replays once after
 * a token refresh on 401. Leaving TanStack's default 3 retries on top would
 * multiply those: a 503 would be attempted 3 times by the transport, and that
 * whole sequence repeated 3 times by the query layer. Nine calls, exponentially
 * spaced, for one failed list.
 *
 * So retries live in exactly one layer. By the time an error reaches TanStack it
 * has already been retried if it deserved it, and the taxonomy on it says what
 * the screen should render instead.
 */
export function createQueryClient(): QueryClient {
  const config: QueryClientConfig = {
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.list,
        gcTime: 5 * 60_000,
        retry: false,
        // Safe to leave on: TanStack only refetches on focus when the query is
        // already stale, so a list inside its 30s window ignores an alt-tab
        // while a live query (staleTime 0) refreshes immediately.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        // Errors are typed and carry intent; components render from that.
        throwOnError: false,
      },
      mutations: {
        retry: false,
        throwOnError: false,
      },
    },
  };

  return new QueryClient(config);
}

/**
 * Server-side QueryClient.
 *
 * A fresh instance per request — a module-level singleton would leak one
 * user's data into another user's prefetch. `staleTime` is non-zero so that
 * data prefetched during the render is not immediately refetched on the client
 * the moment it hydrates.
 */
export function createServerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME.list,
        retry: false,
      },
    },
  });
}

/** True when an error should send the user to sign-in rather than an error state. */
export function shouldRedirectToSignIn(error: unknown): boolean {
  return isVectorbeaApiError(error) && error.intent === "unauthenticated";
}
