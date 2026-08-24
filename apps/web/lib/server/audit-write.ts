import "server-only";

import { createHash } from "crypto";
import type { NextRequest } from "next/server";

import { appQuery } from "@/lib/server/app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   APPENDING TO THE GOVERNANCE TRAIL FROM THE WEB APP

   `audit_log` is written by the Kotlin API's `AuditLog.kt` for everything that
   happens there. Settings, however, are mutated by Next.js route handlers —
   renaming a workspace, changing a role, removing a member, deleting a
   workspace — and none of that reached the trail. A governance surface whose
   own changes are invisible to it is not a governance surface.

   This is the same contract as the Kotlin writer, deliberately:
     · append only — one verb, `recordAuditEvent`. A correction is a new row.
     · never throws — an audit write failing must not fail the action it audits.
       Refusing a role change because the log is unavailable turns a compliance
       feature into an outage. The failure is logged at ERROR, because a gap in
       an audit trail is a problem even when it is invisible.
     · before AND after — "someone changed the settings" is not an audit trail.
     · the IP is hashed with the same salt and truncation as the Kotlin side, so
       "was this the same client" correlates across both writers.
══════════════════════════════════════════════════════════════════════════════ */

/** The actions this app records. Mirrors `AuditLog.Action` in the Kotlin API. */
export const AuditAction = {
  SETTINGS_UPDATE: "settings.update",
  MEMBER_INVITE: "member.invite",
  MEMBER_INVITE_REVOKE: "member.invite_revoke",
  MEMBER_ROLE_CHANGE: "member.role_change",
  MEMBER_REMOVE: "member.remove",
  MEMBER_LEAVE: "member.leave",
  PROFILE_UPDATE: "profile.update",
  PASSWORD_CHANGE: "auth.password_change",
  LIMIT_REQUEST: "limit.request",
  DATA_DELETE: "data.delete",
} as const;

export type AuditActionValue = (typeof AuditAction)[keyof typeof AuditAction];
export type AuditOutcome = "success" | "denied" | "error";

/**
 * Client IP, preferring the proxy header.
 *
 * `x-forwarded-for` is client-controlled and so worthless as identity — but it
 * is only ever hashed for correlation here, never for authorisation, so a
 * forged value costs nothing more than a useless correlation key.
 */
function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || null;
}

/**
 * Salted, so the hashes are not reversible with a rainbow table of the IPv4
 * space — which is small enough to enumerate exhaustively, making an unsalted
 * hash of an IP barely better than storing the IP.
 */
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.AUDIT_IP_SALT ?? "vectorbea-audit";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export interface AuditEventInput {
  workspaceId: string;
  action: AuditActionValue | string;
  targetType: string;
  targetId?: string | null;
  environmentId?: string | null;
  actorType?: "user" | "system" | "api_key";
  actorId?: string | null;
  before?: unknown;
  after?: unknown;
  result?: AuditOutcome;
  request?: NextRequest;
}

export async function recordAuditEvent(event: AuditEventInput): Promise<void> {
  try {
    await appQuery(
      `INSERT INTO audit_log (
         workspace_id, environment_id, actor_type, actor_id,
         action, target_type, target_id,
         before_json, after_json, ip_hash, user_agent, result
       ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8::jsonb, $9::jsonb, $10, $11, $12)`,
      [
        event.workspaceId,
        event.environmentId ?? null,
        event.actorType ?? "user",
        event.actorId ?? null,
        event.action,
        event.targetType,
        event.targetId ?? null,
        event.before === undefined ? null : JSON.stringify(event.before),
        event.after === undefined ? null : JSON.stringify(event.after),
        event.request ? hashIp(clientIp(event.request)) : null,
        event.request?.headers.get("user-agent")?.slice(0, 500) ?? null,
        event.result ?? "success",
      ],
    );
  } catch (error) {
    console.error(
      `[audit] FAILED to record ${event.action} on ${event.targetType} for workspace ` +
        `${event.workspaceId}: ${error instanceof Error ? error.message : String(error)} — ` +
        "this is a gap in the audit trail",
    );
  }
}

/**
 * Record an event that belongs to a person rather than to one workspace.
 *
 * `audit_log.workspace_id` is NOT NULL — correctly, because the log is read per
 * tenant and a row belonging to none would be invisible to every reader. A
 * profile change genuinely spans workspaces, so it is recorded once in each one
 * the person is an active member of: the workspace whose Members list shows
 * their name is the workspace whose audit log should be able to explain when
 * the name changed.
 *
 * A person in no workspace produces no rows, which is correct — there is no
 * tenant with a reason to know.
 */
export async function recordUserScopedAuditEvent(
  userId: string,
  event: Omit<AuditEventInput, "workspaceId">,
): Promise<void> {
  try {
    const workspaces = await appQuery<{ workspace_id: string }>(
      `SELECT workspace_id FROM workspace_members
        WHERE user_id = $1::uuid AND status = 'active'`,
      [userId],
    );
    await Promise.all(
      workspaces.map((row) => recordAuditEvent({ ...event, workspaceId: row.workspace_id })),
    );
  } catch (error) {
    console.error(
      `[audit] FAILED to record ${event.action} for user ${userId}: ` +
        `${error instanceof Error ? error.message : String(error)} — this is a gap in the audit trail`,
    );
  }
}
