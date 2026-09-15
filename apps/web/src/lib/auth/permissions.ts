import { contracts } from "@vectorbea/shared";

export type WorkspaceRole = contracts.WorkspaceRole;

/**
 * The permission matrix, and the ONE place a role becomes a capability.
 *
 * THE BUG THIS EXISTS TO PREVENT
 * ──────────────────────────────
 * The Settings page showed "Your role: Viewer" beside a row saying Owner. The
 * cause was not the display — it was that the role reached the two places by
 * different routes, and one of them passed through a union that did not contain
 * `owner`:
 *
 *     type WorkspaceRole = "viewer" | "editor" | "admin";   // three values
 *     CHECK (role IN ('owner','admin','developer','viewer')) // four, different
 *
 * `normalizeRole` fell through on `owner` and returned `"viewer"`. Since every
 * OAuth sign-up is inserted as `owner`, **every owner was authorised as a
 * viewer**. The visible symptom was a mislabelled header; the real one was
 * `hasWorkspaceRole(role, "admin")` returning false for the workspace owner.
 *
 * So: roles come from `/api/me` and nowhere else, they are normalised once on
 * parse, and capability is derived here rather than re-decided per screen.
 *
 * CLIENT-SIDE GATING IS PRESENTATION, NEVER SECURITY.
 * Everything in this file decides what to *show*. The server decides what is
 * *allowed*. A user who defeats this sees a button; they do not gain a
 * permission, because the API re-checks. Any endpoint relying on this file for
 * enforcement is a vulnerability, not a feature.
 */

export type Capability =
  | "workflow.view"
  | "workflow.edit"
  | "workflow.publish"
  | "workflow.delete"
  | "run.view"
  | "run.trigger"
  | "run.cancel"
  | "run.retry"
  | "approval.decide"
  | "connection.view"
  | "connection.edit"
  | "connection.rotate"
  | "agent.edit"
  | "tool.edit"
  | "member.view"
  | "member.manage"
  | "settings.edit"
  | "apikey.manage"
  | "workspace.danger";

/**
 * Minimum role for each capability.
 *
 * A table rather than a chain of `if (role === …)`: the question customers
 * actually ask is "can a developer publish", and a table answers it by being
 * read. It is also the thing the RBAC matrix in the Members screen renders, so
 * the documentation cannot drift from the enforcement.
 */
const REQUIRED: Record<Capability, WorkspaceRole> = {
  "workflow.view": "viewer",
  "workflow.edit": "developer",
  "workflow.publish": "admin",
  "workflow.delete": "admin",

  "run.view": "viewer",
  "run.trigger": "developer",
  "run.cancel": "developer",
  "run.retry": "developer",

  "approval.decide": "admin",

  "connection.view": "viewer",
  "connection.edit": "admin",
  // Rotating a credential is destructive and irreversible for anything holding
  // the old one, so it sits with the owner rather than with connection.edit.
  "connection.rotate": "owner",

  "agent.edit": "developer",
  "tool.edit": "developer",

  "member.view": "viewer",
  "member.manage": "admin",
  "settings.edit": "admin",

  /*
   * Minting, rotating and revoking a key. Mirrors `RbacGuard`, which holds all
   * four of those routes to `WORKSPACE_WRITE` — admin and owner.
   *
   * The floor is not arbitrary and the API's own comment says why: a key acts
   * as somebody, and an admin may mint one that acts as NOBODY, whose spend is
   * charged to the workspace and to no member's cap. Below admin, that is a way
   * around the budget a host set for a guest. Listing the keys is a read and is
   * NOT gated here — being unable to see which credentials exist in a workspace
   * you belong to helps nobody.
   */
  "apikey.manage": "admin",

  "workspace.danger": "owner",
};

export function can(role: WorkspaceRole, capability: Capability): boolean {
  return contracts.roleAtLeast(role, REQUIRED[capability]);
}

/** The role a capability needs, for "Only admins can…" copy. */
export function requiredRole(capability: Capability): WorkspaceRole {
  return REQUIRED[capability];
}

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  developer: "Developer",
  viewer: "Viewer",
};

export function roleLabel(role: WorkspaceRole): string {
  return ROLE_LABEL[role];
}

/**
 * Why an action is unavailable, phrased for the person reading it.
 *
 * Returns null when the action IS permitted, so a caller can use it directly as
 * a disabled-reason. States the current role and the required one: "You are a
 * Developer; publishing needs Admin" tells someone who to ask. "Permission
 * denied" does not.
 */
export function denialReason(role: WorkspaceRole, capability: Capability): string | null {
  if (can(role, capability)) return null;
  return `Your role is ${roleLabel(role)}. This needs ${roleLabel(requiredRole(capability))} or higher.`;
}

export const ALL_CAPABILITIES = Object.keys(REQUIRED) as Capability[];
export const ALL_ROLES: WorkspaceRole[] = ["viewer", "developer", "admin", "owner"];
