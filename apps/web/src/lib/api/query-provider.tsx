"use client";

import * as React from "react";
import { HydrationBoundary, QueryClientProvider, type DehydratedState } from "@tanstack/react-query";

import { createQueryClient } from "./query-client";

/**
 * QueryClient provider with hydration.
 *
 * The client is created in `useState`'s initialiser rather than at module scope.
 * A module-level client is shared across every request on the server, which
 * would leak one user's cached data into another user's render; creating it
 * inside the component gives each browser tab exactly one, and each SSR pass
 * its own.
 */
export function QueryProvider({
  children,
  dehydratedState,
}: {
  children: React.ReactNode;
  dehydratedState?: DehydratedState;
}) {
  const [queryClient] = React.useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
    </QueryClientProvider>
  );
}
