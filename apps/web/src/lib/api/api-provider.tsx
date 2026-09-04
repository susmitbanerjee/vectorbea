"use client";

import * as React from "react";

import { getAccessToken } from "~/lib/auth/token";
import { notifySessionExpired } from "~/lib/auth/session-provider";
import { createVectorbeaClient, type VectorbeaClient } from "./client";

const ApiContext = React.createContext<VectorbeaClient | null>(null);

/**
 * Provides the API client.
 *
 * The client is created ONCE and never recreated: it holds no React state, and
 * a new instance per render would defeat the single-flight refresh guard by
 * giving each render its own in-flight promise.
 *
 * The two callbacks are the whole bridge between the transport and React:
 *
 *   getToken         — delegates to the single-flight provider, so a burst of
 *                      401s across concurrent queries produces one refresh.
 *   onSessionExpired — fires only when a refresh could not rescue a 401, and is
 *                      routed through the session provider so teardown and the
 *                      redirect happen in one place.
 */
export function ApiProvider({ children }: { children: React.ReactNode }) {
  const client = React.useMemo(
    () =>
      createVectorbeaClient({
        getToken: async ({ forceRefresh }) => {
          const token = await getAccessToken({ forceRefresh });
          return token?.token ?? null;
        },
        onSessionExpired: notifySessionExpired,
      }),
    [],
  );

  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): VectorbeaClient {
  const client = React.useContext(ApiContext);
  if (!client) {
    throw new Error("useApi must be used inside <ApiProvider>.");
  }
  return client;
}
