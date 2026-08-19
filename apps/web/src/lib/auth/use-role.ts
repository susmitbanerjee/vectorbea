"use client";

import { useApi, useApiQuery } from "~/lib/api";
import { queryKeys } from "~/lib/api/keys";
import { useWorkspace } from "~/lib/workspace/workspace-provider";
import { can, denialReason, type Capability, type WorkspaceRole } from "./permissions";

/**
 * The current user's role IN THE CURRENT WORKSPACE, and what it permits.
 *
 * This hook is the only supported way for a screen to learn the role. Not
 * because a second way would be inconvenient, but because a second way is
 * literally the bug: the Settings page derived it independently from the
 * members table and showed "Your role: Viewer" next to a row saying Owner.
 *
 * Role is per membership, so it is looked up by the ACTIVE workspace id. A hook
 * returning "the user's role" without a workspace would be wrong the moment
 * someone owns one workspace and views another.
 */
export interface RoleState {
  role: WorkspaceRole;
  /** False until `/api/me` resolves. Gate destructive UI on this. */
  resolved: boolean;
  loading: boolean;
  can(capability: Capability): boolean;
  /** Null when permitted; otherwise a sentence naming the required role. */
  denialReason(capability: Capability): string | null;
}

export function useRole(): RoleState {
  const api = useApi();
  const { workspaceId } = useWorkspace();

  const query = useApiQuery({
    queryKey: queryKeys.me(),
    queryFn: () => api.me(),
    // Identity is not workspace-scoped and changes rarely; a role change
    // arriving a minute late is acceptable, a role fetched on every screen is
    // not.
    staleTime: 60_000,
  });

  const membership = query.data?.workspaces.find((w) => w.id === workspaceId);

  /**
   * Least privilege until proven otherwise.
   *
   * While `/api/me` is in flight the role is `viewer`, so no destructive control
   * is enabled on a guess. `resolved` distinguishes "genuinely a viewer" from
   * "we do not know yet" — a screen that wants to render a skeleton rather than
   * a disabled button reads that instead.
   */
  const role: WorkspaceRole = membership?.role ?? "viewer";
  const resolved = query.isSuccess && membership !== undefined;

  return {
    role,
    resolved,
    loading: query.isLoading,
    can: (capability) => resolved && can(role, capability),
    denialReason: (capability) =>
      resolved ? denialReason(role, capability) : "Checking your permissions…",
  };
}

export type { Capability, WorkspaceRole };
