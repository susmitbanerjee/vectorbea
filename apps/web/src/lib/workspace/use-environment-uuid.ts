"use client";

import * as React from "react";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { useScope } from "./workspace-provider";

/* ══════════════════════════════════════════════════════════════════════════════
   THE ENVIRONMENT UUID

   Reads carry the environment as an OPTIONAL header, so the app can get away
   with the slug the workspace provider holds ("development"): the transport
   drops anything that is not a UUID and the request degrades to workspace
   scope. Writes cannot degrade — `POST /api/tools`, `POST /api/agents`,
   `POST /api/workflows` and `POST /api/architect/sessions` all resolve an
   environment server-side.

   WHAT THIS USED TO DO, AND WHY IT BLOCKED TOOL REGISTRATION

   The only endpoint that returned an environment id was `GET /api/bootstrap`,
   and it was not scoped to anybody: it took the OLDEST workspace in the
   database and returned that workspace's first environment. For whoever owned
   that workspace the answer was right by luck; for every other account it was
   another tenant's id. This hook therefore compared bootstrap's `workspaceId`
   against the active one and, when they differed, reported `foreign` — and the
   create dialogs turned that into "the environment the API returned belongs to
   a different workspace… registering would write into the wrong tenant" and
   refused to submit. Correct, and a dead end: any account that did not own the
   database's oldest workspace could read everything and create nothing.

   WHAT IT DOES NOW

   `GET /api/environments` is workspace-scoped — `Request.context()` verifies
   membership before the query, so the list cannot contain another tenant's
   environment and there is nothing left to second-guess. A workspace with no
   environment row gets its default created by that same call, so a brand-new
   workspace can register its first tool immediately.

   The server is the guard, not this hook: `requireEnvironmentId()` refuses an
   environment belonging to another workspace with 403 and resolves a missing
   one to the workspace's own default. Sending the wrong id is no longer a way
   to write into the wrong tenant, so refusing to send one is no longer
   protective — it was only ever costing people the ability to create anything.
══════════════════════════════════════════════════════════════════════════════ */

/** Written by `hooks/useBootstrap.ts`. Shared, so do not rename either side. */
const STORAGE_KEY = "vectorbea.activeEnvironmentId";
const WORKSPACE_STORAGE_KEY = "vectorbea.activeWorkspaceId";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readStored(key: string): string | null {
  try {
    const raw = window.localStorage.getItem(key)?.trim();
    return raw && UUID_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export interface EnvironmentUuid {
  /** The environment UUID for the CURRENT workspace, or null when unknown. */
  environmentId: string | null;
  /** True while the lookup is in flight. */
  loading: boolean;
  /**
   * Set when no environment could be resolved for this workspace — which now
   * means only one thing: the API could not be reached. A caller that needs to
   * WRITE should say the workspace could not be read rather than blaming the
   * data, because there is no longer a wrong-tenant case to warn about.
   */
  unresolved: boolean;
}

/**
 * Resolve the environment UUID every write endpoint requires.
 *
 * Deliberately NOT wired into the workspace provider: the provider's
 * `environmentId` is a slug that appears in URLs and cache keys, and swapping a
 * UUID into it would change every query key in the app for no read benefit.
 */
export function useEnvironmentUuid(): EnvironmentUuid {
  const api = useApi();
  const { workspaceId } = useScope();

  const scope = React.useMemo(
    () => ({ workspaceId, environmentId: null }),
    [workspaceId],
  );

  const query = useApiQuery({
    // Keyed on the workspace: switching workspaces must not reuse the previous
    // one's environment, which is the same class of mistake the old bootstrap
    // comparison existed to catch.
    queryKey: ["session", "environments", workspaceId ?? "none"],
    queryFn: () => api.environments(scope),
    enabled: Boolean(workspaceId),
    staleTime: Infinity,
    retry: 1,
  });

  const resolved = React.useMemo(() => {
    const fromApi = query.data?.defaultEnvironmentId ?? query.data?.items[0]?.id ?? null;
    if (fromApi && UUID_RE.test(fromApi)) return fromApi;

    /* The cached value is written by the legacy `useBootstrap` hook, which calls
       the UNAUTHENTICATED bootstrap endpoint — so it may well hold the oldest
       workspace's ids rather than this account's. It is used only as a bridge
       for the moments before the query settles, and only when it was cached
       against the workspace we are actually in. Both halves are required: a
       cached environment with no cached workspace to vouch for it is exactly the
       foreign id this hook used to have to defend against. */
    if (typeof window === "undefined" || !workspaceId) return null;
    const cached = readStored(STORAGE_KEY);
    const cachedWorkspace = readStored(WORKSPACE_STORAGE_KEY);
    if (!cached || cachedWorkspace !== workspaceId) return null;
    return cached;
  }, [query.data, workspaceId]);

  // `isPending` stays true for a query with no data even when nothing is in
  // flight, so `isFetching` is the one that answers "are we still waiting".
  const loading = resolved === null && (query.isFetching || !workspaceId);

  return {
    environmentId: resolved,
    loading,
    unresolved: !loading && resolved === null,
  };
}
