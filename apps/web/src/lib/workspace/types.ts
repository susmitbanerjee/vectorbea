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
