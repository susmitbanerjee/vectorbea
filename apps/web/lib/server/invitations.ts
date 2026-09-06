import "server-only";

import { createHash, randomBytes, randomUUID } from "crypto";

import { appQuery, appQueryOne, withTransaction } from "@/lib/server/app-db";
import { requireSeatForNewMember } from "@/lib/server/entitlements";
import { emailConfigured, sendEmail } from "@/lib/server/email";
import { teamInvitationEmail, workspaceWelcomeEmail } from "@/lib/server/email-templates";
import { parseRole, type MemberRole } from "@/lib/server/workspace-members";

/* ══════════════════════════════════════════════════════════════════════════════
   INVITATIONS

   This wrote `vectorbea.workspace_invitations` in a Supabase project that no
   environment provisions, so inviting a teammate has never worked in any
   deployment — the POST returned an error and the Members screen showed an
   empty list that looked like "nobody has been invited".

   It now writes `public.workspace_invitations` (V038), beside the members it
   creates.

   THE ROLES ARE THE DATABASE'S ROLES. The old allow-list was
   `admin | editor | viewer`, and `editor` violates
   `workspace_members_role_check` — so accepting an invitation created here
   would have failed at the last step even once the table existed. `editor` is
   now an alias for `developer`. `owner` is not invitable: ownership is
   transferred by an existing owner, deliberately.

   THE TOKEN IS NEVER STORED. Only its SHA-256. A leaked database dump must not
   be a set of working invitation links, and there is no feature that needs to
   re-read the raw token — the email is the only copy.
══════════════════════════════════════════════════════════════════════════════ */

const INVITE_TTL_HOURS = 72;

/** Ownership is transferred, not invited. */
const INVITABLE_ROLES: MemberRole[] = ["admin", "developer", "viewer"];

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  role: MemberRole;
  invitedBy: string | null;
  inviterName: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Derived, so the screen does not recompute expiry from three fields. */
  state: "pending" | "accepted" | "revoked" | "expired";
}

interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  invited_by: string | null;
  inviter_name: string;
  expires_at: Date | string;
  accepted_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toInvitation(row: InvitationRow): Invitation {
  const expiresAt = iso(row.expires_at)!;
  const acceptedAt = iso(row.accepted_at);
  const revokedAt = iso(row.revoked_at);
  const state: Invitation["state"] = acceptedAt
    ? "accepted"
    : revokedAt
      ? "revoked"
      : Date.parse(expiresAt) <= Date.now()
        ? "expired"
        : "pending";
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role === "editor" ? "developer" : (row.role as MemberRole),
    invitedBy: row.invited_by,
    inviterName: row.inviter_name,
    expiresAt,
    acceptedAt,
    revokedAt,
    createdAt: iso(row.created_at)!,
    state,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const SELECT_INVITATION = `
  SELECT id, workspace_id, email, role, invited_by, inviter_name,
         expires_at, accepted_at, revoked_at, created_at
    FROM workspace_invitations`;

export async function createInvitation(args: {
  workspaceId: string;
  email: string;
  role: string;
  /** Null in open/mock-session mode, where there is no real signed-in account. */
  invitedBy: string | null;
  inviterName: string;
  workspaceName: string;
}): Promise<{ invitation: Invitation; token: string; delivery: EmailDelivery }> {
  const role = parseRole(args.role);
  if (!INVITABLE_ROLES.includes(role)) {
    throw new Error("Ownership is transferred from the Members list, not invited.");
  }

  const email = args.email.trim().toLowerCase();
  // Deliberately loose: the authority on whether an address is real is whether
  // the invitation arrives. A stricter pattern rejects valid addresses and
  // teaches nobody anything.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  const already = await appQueryOne<{ role: string }>(
    `SELECT m.role FROM workspace_members m
       JOIN app_users u ON u.id = m.user_id
      WHERE m.workspace_id = $1::uuid AND lower(u.email) = $2 AND m.status = 'active'`,
    [args.workspaceId, email],
  );
  if (already) {
    throw new Error(`${email} is already a member of this workspace.`);
  }

  /*
   * PLAN ENFORCEMENT, before the token is minted and the email is sent.
   *
   * Resolved from the WORKSPACE's billing account, never from the inviter's
   * plan — an admin on Pro inviting somebody into a Free workspace is bound by
   * Free, and the refusal says Free.
   *
   * Here rather than at acceptance, because a refusal at acceptance reaches the
   * invitee, who can do nothing about it, instead of the admin, who can. It also
   * means a seat that cannot be filled is never promised in an email.
   */
  await requireSeatForNewMember({ workspaceId: args.workspaceId, email });

  const rawToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_HOURS * 3600_000).toISOString();

  let row: InvitationRow | null;
  try {
    row = await appQueryOne<InvitationRow>(
      `INSERT INTO workspace_invitations
         (id, workspace_id, email, role, invited_by, inviter_name, token_hash, expires_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6, $7, $8::timestamptz)
       RETURNING id, workspace_id, email, role, invited_by, inviter_name,
                 expires_at, accepted_at, revoked_at, created_at`,
      [
        randomUUID(),
        args.workspaceId,
        email,
        role,
        args.invitedBy || null,
        args.inviterName,
        hashToken(rawToken),
        expires,
      ],
    );
  } catch (error) {
    // The partial unique index is what makes "one live invitation per address"
    // true under concurrency; this turns its message into a sentence.
    const message = error instanceof Error ? error.message : String(error);
    if (/workspace_invitations_pending_idx|duplicate key/i.test(message)) {
      throw new Error(
        `${email} already has a pending invitation. Revoke it first to send a new one.`,
      );
    }
    throw error;
  }
  if (!row) throw new Error("The invitation could not be created.");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "https://vectorbea.com";
  const acceptUrl = `${appUrl.replace(/\/+$/, "")}/auth/accept-invite?token=${rawToken}`;

  const delivery = await deliver(email, () =>
    teamInvitationEmail({
      inviterName: args.inviterName,
      workspaceName: args.workspaceName,
      role,
      acceptUrl,
      expiresAt: expires,
    }),
  );

  return { invitation: toInvitation(row), token: rawToken, delivery };
}

export interface EmailDelivery {
  sent: boolean;
  /** Why it did not send — shown to the admin who clicked Invite, not swallowed. */
  reason: string | null;
  configured: boolean;
}

/**
 * Send, and AWAIT it.
 *
 * This was `void sendEmail(...).catch(...)`, which is the single most common way
 * to lose mail from a serverless function: the handler returns, the runtime
 * freezes the instance, and the in-flight fetch to the provider is discarded
 * mid-request. Nothing throws and nothing logs, so the product reports "invited"
 * and no email exists — which is exactly the symptom reported. `sendEmail` also
 * retries with backoff, so the window it needs is longer than a request that has
 * already returned.
 *
 * Awaiting costs the admin a few hundred milliseconds on a click they are
 * already watching, and buys a truthful answer.
 *
 * It still never throws: the invitation row exists either way, and the screen
 * offers the link to copy — so a mail outage degrades to "send them this link"
 * rather than to a failed invitation the admin has to guess about.
 */
async function deliver(
  to: string,
  build: () => { subject: string; html: string; text: string },
): Promise<EmailDelivery> {
  const configured = emailConfigured();
  if (!configured) {
    return {
      sent: false,
      configured: false,
      reason:
        "Email is not configured for this deployment, so no message was sent. Set RESEND_API_KEY (or SMTP/SendGrid credentials) and EMAIL_FROM.",
    };
  }
  try {
    const result = await sendEmail({ ...build(), to });
    if (result.ok) return { sent: true, configured, reason: null };
    console.error(`[invitations] email to ${to} failed via ${result.provider}: ${result.error}`);
    return { sent: false, configured, reason: result.error ?? "The email provider rejected the message." };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[invitations] email to ${to} threw: ${reason}`);
    return { sent: false, configured, reason };
  }
}

export async function listInvitations(workspaceId: string): Promise<Invitation[]> {
  const rows = await appQuery<InvitationRow>(
    `${SELECT_INVITATION} WHERE workspace_id = $1::uuid ORDER BY created_at DESC LIMIT 200`,
    [workspaceId],
  );
  return rows.map(toInvitation);
}

export async function revokeInvitation(workspaceId: string, invitationId: string): Promise<Invitation> {
  const row = await appQueryOne<InvitationRow>(
    `UPDATE workspace_invitations
        SET revoked_at = now()
      WHERE workspace_id = $1::uuid AND id = $2::uuid AND accepted_at IS NULL AND revoked_at IS NULL
      RETURNING id, workspace_id, email, role, invited_by, inviter_name,
                expires_at, accepted_at, revoked_at, created_at`,
    [workspaceId, invitationId],
  );
  if (!row) {
    throw new Error("That invitation has already been accepted or revoked.");
  }
  return toInvitation(row);
}

export type InvitationPreview =
  | {
      valid: true;
      email: string;
      role: MemberRole;
      workspaceId: string;
      workspaceName: string;
      inviterName: string;
      expiresAt: string;
    }
  | { valid: false; reason: "expired" | "accepted" | "revoked" | "unknown" };

/**
 * Look at an invitation without redeeming it.
 *
 * The accept page needs this for two reasons. It has to show somebody WHAT they
 * are joining before they join it — "Join Acme Operations as a Developer" is a
 * decision; a spinner that silently adds you to a tenant is not. And it lets
 * the page state the real reason a link does not work, instead of the previous
 * page's fixed paragraph listing every possible reason at once ("the link has
 * expired, was already accepted, or was revoked") on top of any failure,
 * including failures that had nothing to do with the invitation.
 *
 * No session required: the token is the authorisation, and requiring a login
 * first means the invitee cannot see what they are being asked to sign in for.
 * Only the fields already known to whoever holds the link are returned.
 */
export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const row = await appQueryOne<InvitationRow & { workspace_name: string }>(
    `SELECT i.id, i.workspace_id, i.email, i.role, i.invited_by, i.inviter_name,
            i.expires_at, i.accepted_at, i.revoked_at, i.created_at,
            w.name AS workspace_name
       FROM workspace_invitations i
       JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token_hash = $1`,
    [hashToken(token)],
  );

  if (!row) return { valid: false, reason: "unknown" };
  const invitation = toInvitation(row);
  if (invitation.state !== "pending") {
    return {
      valid: false,
      reason: invitation.state === "accepted" ? "accepted"
        : invitation.state === "revoked" ? "revoked"
          : "expired",
    };
  }
  return {
    valid: true,
    email: invitation.email,
    role: invitation.role,
    workspaceId: invitation.workspaceId,
    workspaceName: row.workspace_name,
    inviterName: invitation.inviterName,
    expiresAt: invitation.expiresAt,
  };
}

export interface AcceptedInvitation {
  workspaceId: string;
  workspaceName: string;
  role: MemberRole;
  /** Whether the welcome email reached them. Never blocks the join. */
  welcome: EmailDelivery;
}

/**
 * Accept an invitation.
 *
 * Redeeming the token and creating the membership are one transaction. Split
 * apart, a failure between them either grants access with the token still live
 * (a second person can redeem the same invitation) or burns the token without
 * granting anything (the invitee is locked out with no way back).
 */
export async function acceptInvitation(token: string, userId: string): Promise<AcceptedInvitation> {
  const tokenHash = hashToken(token);

  /*
   * SEATS ARE CHECKED AGAIN HERE, and deliberately BEFORE the transaction.
   *
   * The invitation-time check is the primary one — it refuses the admin, who can
   * act on it. This one catches the window between: an account that downgraded,
   * or filled its last seat from another workspace, after the invitation went
   * out. Without it, a Free account could hand out invitations before a
   * downgrade and have them all land afterwards.
   *
   * BEFORE the transaction, not inside it. `requireSeatForNewMember` takes its
   * own pooled connections, and calling it while holding the transaction's
   * connection is hold-and-wait: with `max: 3` on this pool, three concurrent
   * acceptances would each own one connection and each need another, and none
   * could release until it got one. The read below is a plain SELECT, so moving
   * it out costs a small TOCTOU window and buys a class of deadlock that does
   * not appear until the moment several people accept at once.
   */
  const pending = await appQueryOne<{ workspace_id: string }>(
    `SELECT workspace_id FROM workspace_invitations
      WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  if (pending) {
    await requireSeatForNewMember({ workspaceId: pending.workspace_id, userId });
  }

  const joined = await withTransaction(async (tx) => {
    const rows = await tx.query<InvitationRow & { workspace_name: string }>(
      `UPDATE workspace_invitations i
          SET accepted_at = now()
         FROM workspaces w
        WHERE i.token_hash = $1
          AND i.workspace_id = w.id
          AND i.accepted_at IS NULL
          AND i.revoked_at IS NULL
          AND i.expires_at > now()
        RETURNING i.id, i.workspace_id, i.email, i.role, i.invited_by, i.inviter_name,
                  i.expires_at, i.accepted_at, i.revoked_at, i.created_at,
                  w.name AS workspace_name`,
      [tokenHash],
    );

    const row = rows[0];
    if (!row) {
      // One message for every failure mode. Distinguishing "expired" from
      // "already used" from "never existed" tells somebody holding a stolen
      // link which of the three they have.
      throw new Error("This invitation link is no longer valid. Ask for a new one.");
    }

    const role = row.role === "editor" ? "developer" : (row.role as MemberRole);
    await tx.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status)
       VALUES ($1::uuid, $2::uuid, $3, 'active')
       ON CONFLICT (workspace_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, status = 'active', updated_at = now()`,
      [row.workspace_id, userId, role],
    );

    return {
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      role,
      inviterName: row.inviter_name,
    };
  });

  /*
   * The welcome email is sent AFTER the transaction commits, never inside it.
   *
   * Inside, a mail provider timing out would roll back a membership that was
   * legitimately earned — the person would click a now-burned link and be told
   * their invitation is invalid. Joining is the guarantee; the email is a
   * courtesy that follows it.
   */
  const context = await appQueryOne<{ email: string | null; other_workspaces: string }>(
    `SELECT u.email,
            (SELECT count(*) FROM workspace_members m
              WHERE m.user_id = u.id AND m.status = 'active'
                AND m.workspace_id <> $2::uuid) AS other_workspaces
       FROM app_users u WHERE u.id = $1::uuid`,
    [userId, joined.workspaceId],
  );

  const welcome = context?.email
    ? await deliver(context.email, () =>
        workspaceWelcomeEmail({
          workspaceName: joined.workspaceName,
          workspaceId: joined.workspaceId,
          role: joined.role,
          invitedByName: joined.inviterName || null,
          hasOtherWorkspaces: Number(context.other_workspaces ?? 0) > 0,
        }),
      )
    : { sent: false, configured: emailConfigured(), reason: "No email address on file for this account." };

  return {
    workspaceId: joined.workspaceId,
    workspaceName: joined.workspaceName,
    role: joined.role,
    welcome,
  };
}
