"use client";

import * as React from "react";
import { useApi } from "~/lib/api/api-provider";
import { useApiQuery } from "~/lib/api/hooks";
import { useScope } from "./workspace-provider";

/* ══════════════════════════════════════════════════════════════════════════════
   THE ENVIRONMENT UUID

   Reads carry the environment as an OPTIONAL header, so the app has been able
   to get away with the slug the workspace provider holds ("development"): the
   transport drops anything that is not a UUID and the request degrades to
   workspace scope. Writes cannot degrade. `POST /api/workflows` and
   `POST /api/architect/sessions` both call `requireEnvironmentId()`, so without
   a real UUID they fail with

     400  X-Environment-Id header is required

   IT MUST BE THIS WORKSPACE'S ENVIRONMENT, AND THAT IS THE HARD PART.

   `GET /api/bootstrap` is the only endpoint that returns an environment id, and
   it is not scoped to anybody: it takes the OLDEST workspace in the database and
   returns that workspace's first environment. For whoever owns that workspace
   the answer is right by luck. For every other account it is another tenant's
   environment id — and `WorkflowRoutes.create` does NOT check that the
   environment belongs to the workspace, so sending it would write rows into a
   workspace with a foreign `environment_id`, which reads back as an empty
   screen and is a cross-tenant scope bug rather than a UI one.

   So the id is accepted ONLY when bootstrap's own `workspaceId` matches the
   workspace we are actually in. When it does not, this reports unresolved and
   the write surfaces say so, which is the honest outcome: refusing to write is
   recoverable, writing into the wrong environment is not.

   THE REAL FIX IS AN ENDPOINT. There is no per-workspace environment route in
   `api-kotlin` — `GET /api/environments` does not exist. Until it does, any
   account that does not own the database's oldest workspace can read everything
   and create nothing. See docs/integration/API-GAPS.md.
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
   * Set when no environment could be resolved for this workspace.
   *
   * A caller that needs to WRITE should surface this rather than sending the
   * request: without the header the API answers 400, and with the wrong one it
   * silently writes into another workspace's environment.
   */
  unresolved: boolean;
  /**
   * True when an environment exists but belongs to a DIFFERENT workspace, so it
   * was deliberately not used. Distinguished from "could not reach the API"
   * because the two need different sentences.
   */
  foreign: boolean;
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

  const query = useApiQuery({
    queryKey: ["session", "bootstrap"],
    queryFn: () => api.bootstrap(),
    staleTime: Infinity,
    retry: 1,
  });

  const bootstrapWorkspace = query.data?.workspaceId ?? null;
  const bootstrapEnvironment = query.data?.environmentId ?? null;

  /**
   * Does bootstrap's answer belong to the workspace we are in?
   *
   * `workspaceId` may be a slug in fixture-backed setups, so the comparison is
   * only meaningful when both sides are UUIDs. When they are not comparable we
   * fall back to trusting it — that is the single-workspace local-dev case,
   * where bootstrap's workspace is by definition the one we are in.
   */
  const comparable = Boolean(workspaceId) && UUID_RE.test(workspaceId ?? "") && bootstrapWorkspace !== null;
  const matchesWorkspace = comparable ? bootstrapWorkspace === workspaceId : true;

  const resolved = React.useMemo(() => {
    if (bootstrapEnvironment && UUID_RE.test(bootstrapEnvironment) && matchesWorkspace) {
      return bootstrapEnvironment;
    }
    // The cached value is written by the legacy bootstrap provider from the
    // same unscoped endpoint, so it is only trustworthy under the same test.
    const cached = typeof window === "undefined" ? null : readStored(STORAGE_KEY);
    const cachedWorkspace = typeof window === "undefined" ? null : readStored(WORKSPACE_STORAGE_KEY);
    if (!cached) return null;
    if (comparable && cachedWorkspace !== null && cachedWorkspace !== workspaceId) return null;
    return cached;
  }, [bootstrapEnvironment, matchesWorkspace, comparable, workspaceId]);

  // `isPending` stays true for a query with no data even when nothing is in
  // flight, so `isFetching` is the one that answers "are we still waiting".
  const loading = resolved === null && query.isFetching;
  const foreign = !loading && resolved === null && comparable && !matchesWorkspace;

  return {
    environmentId: resolved,
    loading,
    unresolved: !loading && resolved === null,
    foreign,
  };
}
