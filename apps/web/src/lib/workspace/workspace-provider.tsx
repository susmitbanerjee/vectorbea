"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";

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

export interface WorkspaceState {
  workspaces: Workspace[];
  workspaceId: string | null;
  workspace: Workspace | null;
  environmentId: Environment;
  /** True until the first resolution completes. */
  resolving: boolean;

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
    const allowed = workspaces.filter((w) => !forbidden.current.has(w.id));

    const candidates = [urlWorkspace, readStored(WORKSPACE_STORAGE_KEY), defaultWorkspaceId];
    const chosen =
      candidates.find(
        (id): id is string => typeof id === "string" && allowed.some((w) => w.id === id),
      ) ?? allowed[0]?.id ?? null;

    setWorkspaceId(chosen);

    const envCandidates = [urlEnvironment, readStored(ENVIRONMENT_STORAGE_KEY)];
    const chosenEnv = envCandidates.find(isEnvironment) ?? "development";
    setEnvironmentId(chosenEnv);

    setResolving(false);
  }, [workspaces, urlWorkspace, urlEnvironment, defaultWorkspaceId]);

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

      const fallback = workspaces.find((w) => !forbidden.current.has(w.id))?.id ?? null;
      void applyScope(fallback, environmentId);
    },
    [applyScope, environmentId, queryClient, workspaces],
  );

  const value = React.useMemo<WorkspaceState>(
    () => ({
      workspaces,
      workspaceId,
      workspace: workspaces.find((w) => w.id === workspaceId) ?? null,
      environmentId,
      resolving,
      setWorkspace,
      requestEnvironment,
      pendingEnvironment,
      confirmEnvironment,
      cancelEnvironment,
      invalidateScope,
      reportForbidden,
    }),
    [
      workspaces,
      workspaceId,
      environmentId,
      resolving,
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
