import "server-only";

import { appQuery, appQueryOne, withTransaction } from "@/lib/server/app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   MEMBERSHIP

   `GET /api/workspaces/:id/members` could list members and nothing else — no
   role change, no removal, no way to leave. So the only route from "this person
   left the company" to "this person cannot reach the workspace" was a manual
   UPDATE against production.

   THE ROLES ARE THE DATABASE'S ROLES. `workspace_members_role_check` (V006)
   permits exactly owner, admin, developer and viewer. `editor` appears in older
   invitation code and is NOT a valid value — writing it violates the
   constraint — so it is accepted as an alias for `developer` on the way in and
   never written.

   THE LAST OWNER CANNOT BE REMOVED OR DEMOTED. Not as a UI affordance, as a
   transaction. A workspace with no owner cannot grant anybody a role again, and
   the two ways to reach that state — demoting yourself, and removing the other
   owner at the same moment somebody demotes you — are both races that a
   client-side check loses. The count and the write happen in one statement.
══════════════════════════════════════════════════════════════════════════════ */

export type MemberRole = "owner" | "admin" | "developer" | "viewer";
export type MemberStatus = "active" | "invited" | "disabled";

export const ASSIGNABLE_ROLES: MemberRole[] = ["owner", "admin", "developer", "viewer"];

export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  developer: "Developer",
  viewer: "Viewer",
};

/** `editor` is a legacy alias for `developer`; anything else is refused. */
export function parseRole(value: unknown): MemberRole {
  if (value === "editor") return "developer";
  if (value === "owner" || value === "admin" || value === "developer" || value === "viewer") {
    return value;
  }
  throw new Error(`Unknown role. Choose one of: ${ASSIGNABLE_ROLES.join(", ")}.`);
}

export interface WorkspaceMember {
  userId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: string;
  /** True for the workspace's recorded owner in `workspaces.owner_user_id`. */
  isWorkspaceOwner: boolean;
}

interface MemberRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  created_at: Date | string;
  is_workspace_owner: boolean;
}

function toMember(row: MemberRow): WorkspaceMember {
  return {
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    role: (row.role === "editor" ? "developer" : (row.role as MemberRole)) ?? "viewer",
    status: (row.status as MemberStatus) ?? "active",
    joinedAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    isWorkspaceOwner: row.is_workspace_owner,
  };
}

export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const rows = await appQuery<MemberRow>(
    `SELECT m.user_id, m.role, m.status, m.created_at,
            u.email, u.full_name, u.avatar_url,
            (w.owner_user_id = m.user_id) AS is_workspace_owner
       FROM workspace_members m
       JOIN app_users u ON u.id = m.user_id
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = $1::uuid AND m.status <> 'disabled'
      ORDER BY CASE m.role
                 WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
                 WHEN 'developer' THEN 2 ELSE 3 END,
               lower(COALESCE(u.full_name, u.email, ''))`,
    [workspaceId],
  );
  return rows.map(toMember);
}

export async function getWorkspaceMember(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMember | null> {
  const row = await appQueryOne<MemberRow>(
    `SELECT m.user_id, m.role, m.status, m.created_at,
            u.email, u.full_name, u.avatar_url,
            (w.owner_user_id = m.user_id) AS is_workspace_owner
       FROM workspace_members m
       JOIN app_users u ON u.id = m.user_id
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.workspace_id = $1::uuid AND m.user_id = $2::uuid`,
    [workspaceId, userId],
  );
  return row ? toMember(row) : null;
}

/** Why a membership change was refused — each one is a different sentence to the user. */
export type MemberChangeFailure =
  | "not_a_member"
  | "last_owner"
  | "unchanged";

export class MemberChangeError extends Error {
  constructor(
    readonly reason: MemberChangeFailure,
    message: string,
  ) {
    super(message);
    this.name = "MemberChangeError";
  }
}

/**
 * Change a role.
 *
 * The guard is inside the UPDATE's WHERE clause, not a preceding SELECT: two
 * concurrent demotions of the two remaining owners both pass a prior check and
 * leave the workspace ownerless. Expressed as a predicate, the second one
 * matches no rows.
 */
export async function updateMemberRole(args: {
  workspaceId: string;
  userId: string;
  role: MemberRole;
}): Promise<{ before: WorkspaceMember; after: WorkspaceMember }> {
  const before = await getWorkspaceMember(args.workspaceId, args.userId);
  if (!before || before.status === "disabled") {
    throw new MemberChangeError("not_a_member", "That person is not a member of this workspace.");
  }
  if (before.role === args.role) {
    throw new MemberChangeError("unchanged", `They are already ${ROLE_LABEL[args.role]}.`);
  }

  const rows = await appQuery<{ user_id: string }>(
    `UPDATE workspace_members m
        SET role = $3, updated_at = now()
      WHERE m.workspace_id = $1::uuid
        AND m.user_id = $2::uuid
        AND m.status = 'active'
        AND (
          -- Demoting an owner is allowed only while another active owner remains.
          m.role <> 'owner' OR $3 = 'owner' OR EXISTS (
            SELECT 1 FROM workspace_members other
             WHERE other.workspace_id = m.workspace_id
               AND other.user_id <> m.user_id
               AND other.role = 'owner'
               AND other.status = 'active'
          )
        )
      RETURNING m.user_id`,
    [args.workspaceId, args.userId, args.role],
  );

  if (rows.length === 0) {
    throw new MemberChangeError(
      "last_owner",
      "This is the workspace's only owner. Promote somebody else to owner first — a workspace with no owner cannot grant roles again.",
    );
  }

  // `workspaces.owner_user_id` is a display field, not the authorisation
  // source — but leaving it on somebody who has just been demoted makes
  // Settings say "Owner: Nadia" beside a row reading Admin, which is the same
  // class of two-sources-of-truth bug the role union already caused once.
  await reassignRecordedOwner(args.workspaceId, args.userId);

  const after = await getWorkspaceMember(args.workspaceId, args.userId);
  if (!after) throw new MemberChangeError("not_a_member", "That person is no longer a member.");
  return { before, after };
}

/** Point `workspaces.owner_user_id` at an active owner, if it no longer does. */
async function reassignRecordedOwner(workspaceId: string, changedUserId: string): Promise<void> {
  await appQuery(
    `UPDATE workspaces w
        SET owner_user_id = (
              SELECT m.user_id FROM workspace_members m
               WHERE m.workspace_id = w.id AND m.role = 'owner' AND m.status = 'active'
               ORDER BY m.created_at LIMIT 1)
      WHERE w.id = $1::uuid
        AND w.owner_user_id = $2::uuid
        AND NOT EXISTS (
          SELECT 1 FROM workspace_members m
           WHERE m.workspace_id = w.id AND m.user_id = $2::uuid
             AND m.role = 'owner' AND m.status = 'active')`,
    [workspaceId, changedUserId],
  );
}

/**
 * Remove a member.
 *
 * The row is disabled rather than deleted. Seat counting already filters on
 * `status = 'active'`, so the seat is freed immediately, and the record of who
 * was in this workspace and when survives — which is the question an audit
 * asks, and one a deleted row cannot answer. Re-inviting the same person
 * reactivates this row.
 */
export async function removeMember(args: {
  workspaceId: string;
  userId: string;
}): Promise<WorkspaceMember> {
  const before = await getWorkspaceMember(args.workspaceId, args.userId);
  if (!before || before.status === "disabled") {
    throw new MemberChangeError("not_a_member", "That person is not a member of this workspace.");
  }

  const rows = await appQuery<{ user_id: string }>(
    `UPDATE workspace_members m
        SET status = 'disabled', updated_at = now()
      WHERE m.workspace_id = $1::uuid
        AND m.user_id = $2::uuid
        AND m.status <> 'disabled'
        AND (
          m.role <> 'owner' OR EXISTS (
            SELECT 1 FROM workspace_members other
             WHERE other.workspace_id = m.workspace_id
               AND other.user_id <> m.user_id
               AND other.role = 'owner'
               AND other.status = 'active'
          )
        )
      RETURNING m.user_id`,
    [args.workspaceId, args.userId],
  );

  if (rows.length === 0) {
    throw new MemberChangeError(
      "last_owner",
      "This is the workspace's only owner. Promote somebody else to owner before removing them.",
    );
  }

  // Same reason as a demotion: leaving the recorded owner pointing at somebody
  // who has been removed makes Settings claim an owner who cannot sign in.
  await reassignRecordedOwner(args.workspaceId, args.userId);

  return before;
}

export interface LeaveResult {
  member: WorkspaceMember;
  /** Workspaces the person still belongs to, so the UI knows where to send them. */
  remainingWorkspaces: { id: string; name: string }[];
}

/** Leaving is removing yourself, and carries the same last-owner guard. */
export async function leaveWorkspace(args: {
  workspaceId: string;
  userId: string;
}): Promise<LeaveResult> {
  const member = await removeMember(args);
  const remaining = await appQuery<{ id: string; name: string }>(
    `SELECT w.id, w.name
       FROM workspace_members m
       JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1::uuid AND m.status = 'active'
      ORDER BY w.name`,
    [args.userId],
  );
  return { member, remainingWorkspaces: remaining };
}

/**
 * Add or reactivate a membership. Used when an invitation is accepted.
 *
 * One statement so an accept cannot half-apply, and `ON CONFLICT` so accepting
 * a second invitation, or rejoining after removal, updates the existing row
 * rather than colliding with `workspace_members_workspace_id_user_id_key`.
 */
export async function upsertMembership(args: {
  workspaceId: string;
  userId: string;
  role: MemberRole;
}): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1::uuid, $2::uuid, $3, 'active')
       ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, status = 'active', updated_at = now()`,
      [args.workspaceId, args.userId, args.role],
    );
  });
}
