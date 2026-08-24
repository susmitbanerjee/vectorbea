"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";

import { useApi } from "~/lib/api/api-provider";
import { isUnauthenticated } from "~/lib/api/errors";
import { queryKeys } from "~/lib/api/keys";
import type { Environment, Workspace } from "./types";

const WORKSPACE_STORAGE_KEY = "vectorbea-workspace";
const ENVIRONMENT_STORAGE_KEY = "vectorbea-environment";

const ENVIRONMENTS: readonly Environment[] = ["development", "staging", "production"] as const;

function isEnvironment(value: string | null): value is Environment {
  return value !== null && (ENVIRONMENTS as readonly string[]).includes(value);
}

function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode or blocked storage. Fall through to the default.
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Non-fatal: the selection just will not survive a reload.
  }
}

/**
 * Why the app has no workspace to work in.
 *
 * `null` means there is one. Everything else is a state a screen has to be able
 * to render, because a perpetual skeleton in any of them is a lie.
 */
export type WorkspaceProblem =
  /** Signed out, or the session expired mid-session. */
  | "unauthenticated"
  /** Authenticated, but a member of nothing. A real account state, not an error. */
  | "no-memberships"
  /** The browser reports no network, so the request was never sent. */
  | "offline"
  /** The membership list could not be read at all. */
  | "unreachable";

export interface WorkspaceState {
  workspaces: Workspace[];
  workspaceId: string | null;
  workspace: Workspace | null;
  environmentId: Environment;
  /** True until the first resolution completes. */
  resolving: boolean;
  /** Set when there is no usable workspace, and why. See [WorkspaceProblem]. */
  problem: WorkspaceProblem | null;
  /** Re-read the membership list — the retry behind a "Try again" button. */
  retry(): void;

  setWorkspace(id: string): void;
  /**
   * Switch environment. Moving INTO production does not take effect
   * immediately — it parks in `pendingEnvironment` for confirmation.
   */
  requestEnvironment(next: Environment): void;
  pendingEnvironment: Environment | null;
  confirmEnvironment(): void;
  cancelEnvironment(): void;

  /** Invalidate every query below the current scope. */
  invalidateScope(): Promise<void>;
  /**
   * Called when the API 403s a workspace. Drops the stale selection and
   * re-resolves to one the user can actually see.
   */
  reportForbidden(workspaceId: string): void;
}

const WorkspaceContext = React.createContext<WorkspaceState | null>(null);

export interface WorkspaceProviderProps {
  children: React.ReactNode;
  /** Workspaces the user belongs to, usually server-fetched. */
  workspaces: Workspace[];
  /** The user's default, used when URL and storage say nothing. */
  defaultWorkspaceId?: string | null;
}

/**
 * Resolves workspace and environment, in priority order:
 *
 *   1. URL  (`?ws=…&env=…`)   — shareable and deep-linkable, so it wins
 *   2. localStorage           — the returning user's last choice
 *   3. the user's default     — first workspace the API returned
 *
 * The URL is the source of truth once resolved, so a pasted link opens in the
 * scope it was copied from rather than in whatever the recipient last used.
 */
export function WorkspaceProvider({
  children,
  workspaces,
  defaultWorkspaceId = null,
}: WorkspaceProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const api = useApi();

  /* ── The user's OWN memberships ───────────────────────────────────────────
     THE BUG THIS FIXES: scope came from `GET /api/bootstrap`, which runs

         SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1

     with no user filter, and sits in the API's PUBLIC path set. Every account
     was therefore handed the oldest workspace in the database. Whoever owned it
     worked; everyone else sent `X-Workspace-Id` for a workspace they are not in,
     and `RequestContext` answered every scoped request with

         403  You are not a member of workspace <id>

     `/api/me` is the endpoint for this — its own route comment says it "must be
     called after every login to discover authorized workspaces" — and nothing
     was calling it to resolve scope.

     Plain `useQuery`, not `useApiQuery`: that helper calls `useWorkspace()` to
     route 403s back here, so using it inside this provider is a cycle. `/api/me`
     is not workspace-scoped, so it cannot 403 on scope anyway. */
  const meQuery = useQuery({
    queryKey: queryKeys.me(),
    queryFn: () => api.me(),
    staleTime: 5 * 60_000,
    /**
     * `networkMode: "always"` — DO NOT REMOVE without reading this.
     *
     * TanStack's default mode pauses a query when `navigator.onLine` is false,
     * and a paused query never settles: `isPending` stays true and
     * `fetchStatus` sits on "paused" indefinitely. Every other query in the app
     * can afford that — the screen shows its own error state and recovers on
     * reconnect. This one cannot: it gates the whole shell, so pausing it
     * replaces every screen with a spinner that will never resolve. Observed
     * doing exactly that against an unreachable API.
     *
     * Reachability of OUR API is also not the same question as whether the
     * browser has a network. "always" lets the request be attempted and fail
     * honestly, which is the outcome the gate can actually render.
     *
     * No `retry` override: the client sets `retry: false` globally because the
     * transport already retries the failures worth retrying, and stacking the
     * two multiplies them.
     */
    networkMode: "always",
  });

  /**
   * Headcount per workspace, which `/api/me` does not carry.
   *
   * The switcher renders "{n} members" and n was always 0, because
   * `Workspace.members` is populated by the mock transport and by nothing else.
   * This is a separate, non-blocking query on purpose: scope resolution must
   * not wait on a decoration, and a workspace with an unknown count renders
   * without the line rather than with a confident zero.
   */
  const memberCounts = useQuery({
    queryKey: ["session", "member-counts"],
    queryFn: async (): Promise<Record<string, number>> => {
      const response = await fetch("/api/workspaces/member-counts", { cache: "no-store" });
      if (!response.ok) return {};
      const json = (await response.json()) as { counts?: Record<string, number> };
      return json.counts ?? {};
    },
    staleTime: 5 * 60_000,
    networkMode: "always",
  });

  /**
   * Memberships win over the server-rendered seed the moment they arrive.
   *
   * The seed comes from `/api/bootstrap` and is not user-specific, so it is only
   * ever a first-paint placeholder and a dev-mode fallback.
   */
  const authoritative = meQuery.data?.workspaces;
  const counts = memberCounts.data;
  const resolvedWorkspaces = React.useMemo<Workspace[]>(() => {
    const withCount = (workspace: Workspace): Workspace =>
      counts?.[workspace.id] === undefined
        ? workspace
        : { ...workspace, members: counts[workspace.id] };
    if (!authoritative) return workspaces.map(withCount);
    return authoritative.map((m) => withCount({ id: m.id, name: m.name }));
  }, [authoritative, workspaces, counts]);

  const resolvedDefault = meQuery.data?.defaultWorkspaceId ?? defaultWorkspaceId;

  const urlWorkspace = searchParams.get("ws");
  const urlEnvironment = searchParams.get("env");

  /**
   * Workspaces the API has already rejected with a 403.
   *
   * Without this, re-resolution can pick the same forbidden workspace straight
   * back out of storage and 403 again — the loop the requirement calls out.
   */
  const forbidden = React.useRef<Set<string>>(new Set());

  const [resolving, setResolving] = React.useState(true);
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null);
  const [environmentId, setEnvironmentId] = React.useState<Environment>("development");
  const [pendingEnvironment, setPendingEnvironment] = React.useState<Environment | null>(null);

  const resolve = React.useCallback(() => {
    const allowed = resolvedWorkspaces.filter((w) => !forbidden.current.has(w.id));

    const candidates = [urlWorkspace, readStored(WORKSPACE_STORAGE_KEY), resolvedDefault];
    const chosen =
      candidates.find(
        (id): id is string => typeof id === "string" && allowed.some((w) => w.id === id),
      ) ?? allowed[0]?.id ?? null;

    setWorkspaceId(chosen);

    const envCandidates = [urlEnvironment, readStored(ENVIRONMENT_STORAGE_KEY)];
    const chosenEnv = envCandidates.find(isEnvironment) ?? "development";
    setEnvironmentId(chosenEnv);

    /* Still waiting on the authoritative list: a workspace chosen from the seed
       is a guess, and committing to it is how the wrong one got sent.

       Keyed on "fetching" specifically, NOT on "not yet settled". A query can
       also sit in "paused", which never settles on its own — treating that as
       resolving is a spinner with no end, which is the exact failure this gate
       exists to remove. */
    setResolving(meQuery.fetchStatus === "fetching" && meQuery.data === undefined);
  }, [resolvedWorkspaces, urlWorkspace, urlEnvironment, resolvedDefault, meQuery.fetchStatus, meQuery.data]);

  React.useEffect(() => {
    resolve();
  }, [resolve]);

  const scope = React.useMemo(
    () => ({ workspaceId, environmentId }),
    [workspaceId, environmentId],
  );

  const invalidateScope = React.useCallback(async () => {
    // One call. Because workspace and environment sit at the front of every
    // key, this prefix match reaches every list, detail and summary below them.
    await queryClient.invalidateQueries({
      queryKey: queryKeys.env(scope.workspaceId, scope.environmentId),
    });
  }, [queryClient, scope.workspaceId, scope.environmentId]);

  /** Push the scope into the URL so it is shareable and survives a reload. */
  const syncUrl = React.useCallback(
    (nextWorkspace: string | null, nextEnvironment: Environment) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextWorkspace) params.set("ws", nextWorkspace);
      else params.delete("ws");
      params.set("env", nextEnvironment);
      // typedRoutes cannot know a runtime-built query string; the pathname it
      // is appended to came from usePathname and is already a real route.
      router.replace(`${pathname}?${params.toString()}` as Route, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const applyScope = React.useCallback(
    async (nextWorkspace: string | null, nextEnvironment: Environment) => {
      const previous = queryKeys.env(workspaceId, environmentId);

      setWorkspaceId(nextWorkspace);
      setEnvironmentId(nextEnvironment);
      writeStored(WORKSPACE_STORAGE_KEY, nextWorkspace);
      writeStored(ENVIRONMENT_STORAGE_KEY, nextEnvironment);
      syncUrl(nextWorkspace, nextEnvironment);

      // Drop the scope we just left. Removed rather than invalidated: nothing
      // should be able to paint production numbers under a staging heading
      // while a refetch is in flight.
      queryClient.removeQueries({ queryKey: previous });
    },
    [queryClient, workspaceId, environmentId, syncUrl],
  );

  const setWorkspace = React.useCallback(
    (id: string) => {
      if (id === workspaceId) return;
      void applyScope(id, environmentId);
    },
    [applyScope, workspaceId, environmentId],
  );

  const requestEnvironment = React.useCallback(
    (next: Environment) => {
      if (next === environmentId) return;
      // Production is the one switch that can turn a harmless click into a real
      // consequence, so it asks first.
      if (next === "production") {
        setPendingEnvironment(next);
        return;
      }
      void applyScope(workspaceId, next);
    },
    [applyScope, environmentId, workspaceId],
  );

  const confirmEnvironment = React.useCallback(() => {
    if (!pendingEnvironment) return;
    void applyScope(workspaceId, pendingEnvironment);
    setPendingEnvironment(null);
  }, [applyScope, pendingEnvironment, workspaceId]);

  const cancelEnvironment = React.useCallback(() => setPendingEnvironment(null), []);

  const reportForbidden = React.useCallback(
    (rejected: string) => {
      if (forbidden.current.has(rejected)) return; // already handled; do not loop
      forbidden.current.add(rejected);

      queryClient.removeQueries({ queryKey: queryKeys.workspace(rejected) });
      if (readStored(WORKSPACE_STORAGE_KEY) === rejected) {
        writeStored(WORKSPACE_STORAGE_KEY, null);
      }

      const fallback = resolvedWorkspaces.find((w) => !forbidden.current.has(w.id))?.id ?? null;
      void applyScope(fallback, environmentId);

      // The rejection may be the seed's fault rather than the user's. Re-reading
      // memberships is what turns "403 forever" into "opens in a workspace you
      // are actually in".
      void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
    },
    [applyScope, environmentId, queryClient, resolvedWorkspaces],
  );

  const retry = React.useCallback(() => {
    forbidden.current.clear();
    void meQuery.refetch();
  }, [meQuery]);

  /**
   * No workspace, and why.
   *
   * Reported rather than left as "resolving", because the three causes need
   * three different screens: sign in, ask for an invitation, or try again.
   */
  const problem = React.useMemo<WorkspaceProblem | null>(() => {
    if (workspaceId !== null || resolving) return null;
    // Authenticated with a real answer: zero memberships is the answer.
    if (meQuery.data) return meQuery.data.workspaces.length === 0 ? "no-memberships" : null;
    if (isUnauthenticated(meQuery.error)) return "unauthenticated";
    // Parked because the browser reports no network. Distinct from unreachable:
    // the request was never sent, so "the API did not answer" would be a lie.
    if (meQuery.fetchStatus === "paused") return "offline";
    if (meQuery.fetchStatus === "fetching") return null;
    return resolvedWorkspaces.length === 0 ? "unreachable" : null;
  }, [workspaceId, resolving, meQuery.fetchStatus, meQuery.error, meQuery.data, resolvedWorkspaces]);

  const value = React.useMemo<WorkspaceState>(
    () => ({
      workspaces: resolvedWorkspaces,
      workspaceId,
      workspace: resolvedWorkspaces.find((w) => w.id === workspaceId) ?? null,
      environmentId,
      resolving,
      problem,
      retry,
      setWorkspace,
      requestEnvironment,
      pendingEnvironment,
      confirmEnvironment,
      cancelEnvironment,
      invalidateScope,
      reportForbidden,
    }),
    [
      resolvedWorkspaces,
      workspaceId,
      environmentId,
      resolving,
      problem,
      retry,
      setWorkspace,
      requestEnvironment,
      pendingEnvironment,
      confirmEnvironment,
      cancelEnvironment,
      invalidateScope,
      reportForbidden,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const context = React.useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside <WorkspaceProvider>.");
  }
  return context;
}

/** The scope every query key and API call needs. */
export function useScope(): { workspaceId: string | null; environmentId: Environment } {
  const { workspaceId, environmentId } = useWorkspace();
  return React.useMemo(() => ({ workspaceId, environmentId }), [workspaceId, environmentId]);
}
