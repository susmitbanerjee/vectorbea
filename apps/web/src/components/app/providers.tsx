"use client";

import * as React from "react";
import type { DehydratedState } from "@tanstack/react-query";

import { ApiProvider } from "~/lib/api/api-provider";
import { QueryProvider } from "~/lib/api/query-provider";
import { SessionProvider } from "~/lib/auth/session-provider";
import { WorkspaceProvider } from "~/lib/workspace/workspace-provider";
import type { Session } from "~/lib/auth/session";
import type { Workspace } from "~/lib/workspace/types";
import { MockModeBadge } from "./mock-mode-badge";
import { ContractMismatchOverlay } from "./contract-mismatch-overlay";

export interface AppProvidersProps {
  children: React.ReactNode;
  /** Server-resolved, so the first paint is not a spinner. */
  initialSession?: Session | null;
  workspaces?: Workspace[];
  defaultWorkspaceId?: string | null;
  dehydratedState?: DehydratedState;
}

/**
 * The provider stack, in dependency order.
 *
 *   QueryProvider     — owns the cache; everything below can invalidate it
 *   SessionProvider   — needs the cache to clear it on sign-out
 *   ApiProvider       — needs the session's token source
 *   WorkspaceProvider — needs the cache to invalidate scope, and the API to list
 *
 * Getting this order wrong is not a subtle bug: SessionProvider calls
 * `useQueryClient`, so mounting it above QueryProvider throws on first render.
 */
export function AppProviders({
  children,
  initialSession = null,
  workspaces = [],
  defaultWorkspaceId = null,
  dehydratedState,
}: AppProvidersProps) {
  return (
    <QueryProvider dehydratedState={dehydratedState}>
      <SessionProvider initialSession={initialSession}>
        <ApiProvider>
          <WorkspaceProvider workspaces={workspaces} defaultWorkspaceId={defaultWorkspaceId}>
            <MockModeBadge />
            <ContractMismatchOverlay />
            {children}
          </WorkspaceProvider>
        </ApiProvider>
      </SessionProvider>
    </QueryProvider>
  );
}
