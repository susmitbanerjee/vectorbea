/**
 * Workspace and environment types.
 *
 * Kept separate from the provider so server components can import the shapes
 * without pulling a "use client" module into the server graph.
 */

export type Environment = "development" | "staging" | "production";

export interface Workspace {
  id: string;
  name: string;
  /** Present in fixtures and the API's workspace list; not required to resolve scope. */
  members?: number;
  /**
   * Your role in THIS workspace, from `/api/me`.
   *
   * Carried per workspace, not just for the active one, so the switcher can
   * separate the workspaces you own from the ones you were invited into
   * without a second request.
   */
  role?: WorkspaceRole;
}

/**
 * The four roles, exactly as the database permits them
 * (`workspace_members_role_check`, V006).
 *
 * `editor` is NOT in this union: it is a legacy value that violates the CHECK
 * constraint, and is normalised to `developer` on the way in.
 */
export type WorkspaceRole = "owner" | "admin" | "developer" | "viewer";

/** Rank, for "at least this role" comparisons. Higher is more. */
const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  developer: 1,
  admin: 2,
  owner: 3,
};

/**
 * Whether `role` is at least `required`.
 *
 * `null` — the role is not known yet — returns FALSE, so a control is never
 * offered on the assumption of permission. Callers that would rather wait than
 * flash a disabled control should check `resolving` instead of this.
 */
export function hasRole(role: WorkspaceRole | null, required: WorkspaceRole): boolean {
  if (role === null) return false;
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  developer: "Developer",
  viewer: "Viewer",
};

/**
 * Read a role off the wire.
 *
 * `editor` is a legacy value the database's CHECK constraint does not permit;
 * it means `developer`. Anything unrecognised falls to `viewer`, because an
 * unknown role must mean LESS access, never more. `undefined` stays undefined —
 * "not reported" is not the same claim as "viewer".
 */
export function normalizeRole(raw: string | null | undefined): WorkspaceRole | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === "owner" || raw === "admin" || raw === "developer" || raw === "viewer") return raw;
  if (raw === "editor") return "developer";
  return "viewer";
}
