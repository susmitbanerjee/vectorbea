import "server-only";

import { appQuery, appQueryOne } from "@/lib/server/app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   ASKING FOR MORE

   Two limits on this product cannot be lifted by the person who hits them:

     real execution   `workspace_beta_controls.real_execution_enabled` is set by
                      `POST /api/admin/beta/workspaces/:id/enable-real-execution`,
                      which is behind `requireAdmin` — Vectorbea's
                      `app_users.is_platform_admin`, NOT the workspace's owner
                      role. Real execution means workflows write to the
                      customer's systems and spend their money, so the private
                      beta vets each tenant first.
     capacity         `workspace_usage_policies` is written by the same admin
                      surface.

   A workspace owner reading "an administrator must enable this" reasonably
   concludes they are that administrator, tries, and finds no control. The
   honest version names Vectorbea and gives them the one action they do have:
   ask, on the record.

   `usage_limit_requests` (V015) exists for exactly this and nothing was ever
   built on it — a queue with a schema, no producer and no consumer. This is the
   producer. Platform admins read it through the same table.
══════════════════════════════════════════════════════════════════════════════ */

export type AccessRequestKind = "real_execution" | "capacity" | "seats";
export type AccessRequestStatus = "open" | "approved" | "rejected";

export const REQUEST_LABEL: Record<AccessRequestKind, string> = {
  real_execution: "Enable real execution",
  capacity: "Raise usage limits",
  seats: "Add seats",
};

export interface AccessRequest {
  id: string;
  workspaceId: string;
  kind: AccessRequestKind;
  /** The specific numbers asked for, when the kind carries any. */
  changes: Record<string, number | string | boolean>;
  reason: string | null;
  status: AccessRequestStatus;
  requestedBy: string | null;
  requestedByEmail: string | null;
  requestedByName: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
}

interface RequestRow {
  id: string;
  workspace_id: string;
  requested_change_json: unknown;
  reason: string | null;
  status: string;
  requested_by_user_id: string | null;
  requester_email: string | null;
  requester_name: string | null;
  reviewed_at: Date | string | null;
  decision_reason: string | null;
  created_at: Date | string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRequest(row: RequestRow): AccessRequest {
  const payload = (row.requested_change_json ?? {}) as Record<string, unknown>;
  const kind = payload.kind;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind:
      kind === "real_execution" || kind === "capacity" || kind === "seats" ? kind : "capacity",
    changes: (payload.changes as Record<string, number | string | boolean>) ?? {},
    reason: row.reason,
    status: (row.status as AccessRequestStatus) ?? "open",
    requestedBy: row.requested_by_user_id,
    requestedByEmail: row.requester_email,
    requestedByName: row.requester_name,
    reviewedAt: iso(row.reviewed_at),
    decisionReason: row.decision_reason,
    createdAt: iso(row.created_at)!,
  };
}

const SELECT_REQUEST = `
  SELECT r.id, r.workspace_id, r.requested_change_json, r.reason, r.status,
         r.requested_by_user_id, u.email AS requester_email, u.full_name AS requester_name,
         r.reviewed_at, r.decision_reason, r.created_at
    FROM usage_limit_requests r
    LEFT JOIN app_users u ON u.id = r.requested_by_user_id`;

export async function listAccessRequests(workspaceId: string): Promise<AccessRequest[]> {
  const rows = await appQuery<RequestRow>(
    `${SELECT_REQUEST} WHERE r.workspace_id = $1::uuid ORDER BY r.created_at DESC LIMIT 100`,
    [workspaceId],
  );
  return rows.map(toRequest);
}

export const REASON_MAX = 1000;

export async function createAccessRequest(args: {
  workspaceId: string;
  /** Null in open/mock-session mode, where there is no real signed-in account. */
  userId: string | null;
  kind: AccessRequestKind;
  changes?: Record<string, number | string | boolean>;
  reason?: string | null;
}): Promise<AccessRequest> {
  const reason = args.reason?.trim() || null;
  if (reason && reason.length > REASON_MAX) {
    throw new Error(`Keep the note to ${REASON_MAX} characters or fewer.`);
  }
  if (args.kind === "real_execution" && !reason) {
    // The one request that unlocks writes to production systems is the one a
    // reviewer cannot decide without context. Requiring it here beats a queue
    // of bare "please enable" rows nobody can action.
    throw new Error("Tell us what this workspace will run for real. A reviewer needs the context.");
  }

  const open = await appQueryOne<{ id: string }>(
    `SELECT id FROM usage_limit_requests
      WHERE workspace_id = $1::uuid
        AND status = 'open'
        AND requested_change_json->>'kind' = $2
      LIMIT 1`,
    [args.workspaceId, args.kind],
  );
  if (open) {
    throw new Error(
      `There is already an open request to ${REQUEST_LABEL[args.kind].toLowerCase()}. ` +
        "Adding another does not move it up the queue.",
    );
  }

  const row = await appQueryOne<RequestRow>(
    `WITH inserted AS (
       INSERT INTO usage_limit_requests
         (workspace_id, requested_by_user_id, requested_change_json, reason, status)
       VALUES ($1::uuid, $2::uuid, $3::jsonb, $4, 'open')
       RETURNING *
     )
     SELECT r.id, r.workspace_id, r.requested_change_json, r.reason, r.status,
            r.requested_by_user_id, u.email AS requester_email, u.full_name AS requester_name,
            r.reviewed_at, r.decision_reason, r.created_at
       FROM inserted r
       LEFT JOIN app_users u ON u.id = r.requested_by_user_id`,
    [
      args.workspaceId,
      args.userId || null,
      JSON.stringify({ kind: args.kind, changes: args.changes ?? {} }),
      reason,
    ],
  );
  if (!row) throw new Error("The request could not be recorded.");
  return toRequest(row);
}
