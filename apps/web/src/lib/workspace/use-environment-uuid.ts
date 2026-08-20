"use client";

import * as React from "react";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";

/* ══════════════════════════════════════════════════════════════════════════════
   THE ENVIRONMENT UUID

   Reads carry the environment as an OPTIONAL header, so the app has been able
   to get away with the slug the workspace provider holds ("development"): the
   transport drops anything that is not a UUID and the request degrades to
   workspace scope. Writes cannot degrade. `POST /api/workflows` and
   `POST /api/architect/sessions` both call `requireEnvironmentId()`, so without
   a real UUID they fail with

     400  X-Environment-Id header is required

   and no amount of retrying fixes it.

   `GET /api/bootstrap` is the one endpoint that returns the UUID, and it is in
   the API's public path set precisely so a cold client can identify itself. The
   legacy `BootstrapProvider` in the root layout already calls it and writes the
   result to localStorage under the key below, so on a warm tab this hook costs
   nothing — the fetch is the cold-start path, not the normal one.
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
  /** The real environment UUID, or null while it is still unknown. */
  environmentId: string | null;
  /** True while the bootstrap call is in flight. */
  loading: boolean;
  /**
   * Set when the environment could not be resolved at all. A caller that needs
   * to WRITE should surface this rather than sending the request and letting it
   * come back as a 400 the user cannot act on.
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

  // Read after mount, never in the initialiser — a localStorage read during
  // render makes the server and first client render disagree.
  const [stored, setStored] = React.useState<string | null>(null);
  const [checked, setChecked] = React.useState(false);

  React.useEffect(() => {
    setStored(readStored(STORAGE_KEY));
    setChecked(true);
  }, []);

  const query = useApiQuery({
    queryKey: ["session", "bootstrap"],
    queryFn: () => api.bootstrap(),
    // Only after the localStorage check has actually run, and only when it
    // found nothing. Firing alongside it would double every cold start.
    enabled: checked && stored === null,
    staleTime: Infinity,
    retry: 1,
  });

  React.useEffect(() => {
    const fetched = query.data?.environmentId;
    if (!fetched || !UUID_RE.test(fetched)) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, fetched);
      const workspace = query.data?.workspaceId;
      // The legacy client reads the workspace from the same pair of keys, so
      // writing only one of them leaves the two layers disagreeing about scope.
      if (workspace && UUID_RE.test(workspace) && !readStored(WORKSPACE_STORAGE_KEY)) {
        window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspace);
      }
    } catch {}
    setStored(fetched);
  }, [query.data]);

  const candidate = stored ?? query.data?.environmentId ?? null;
  const environmentId = candidate && UUID_RE.test(candidate) ? candidate : null;

  // `isPending` stays true for a DISABLED query in TanStack v5 — it means "no
  // data", not "in flight" — so reading it directly would leave this hook
  // reporting `loading` forever on the warm path where localStorage already
  // had the id. `isFetching` is the one that answers the question asked here.
  const loading = !checked || (environmentId === null && query.isFetching);

  return { environmentId, loading, unresolved: !loading && environmentId === null };
}
