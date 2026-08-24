import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  assertWorkspaceMember,
  requireWorkspaceRole,
} from "@/lib/server/assert-workspace-member";
import { appQueryOne } from "@/lib/server/app-db";
import { recordAuditEvent, AuditAction } from "@/lib/server/audit-write";
import { createInvitation, listInvitations, revokeInvitation } from "@/lib/server/invitations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { auditActor } from "@/lib/server/settings-auth";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET / POST / DELETE /api/workspaces/:id/invitations

   INVITING NEEDS ADMIN. This route previously accepted an invitation from any
   member, including a viewer — so the least-privileged role in the product
   could hand out access at a higher role than its own. That is not a gap in the
   UI, it is a privilege escalation, and it is fixed at the route rather than by
   hiding a button.

   The workspace name and the inviter's name are read from Postgres. They came
   from Supabase `workspaces` and `profiles`, neither of which exists in any
   deployment — so every invitation that got as far as sending would have been
   addressed from "undefined" about a workspace named by its UUID.
══════════════════════════════════════════════════════════════════════════════ */

const InviteSchema = z.object({
  email: z.string().trim().min(3).max(320),
  role: z.string().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await assertWorkspaceMember(request, id);
    if (auth.error) return auth.error;
    return NextResponse.json({
      invitations: await listInvitations(id),
      yourRole: auth.user.role,
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Invitations could not be loaded");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await assertWorkspaceMember(request, id);
    if (auth.error) return auth.error;

    const actor = auditActor(auth.user);
    const denied = requireWorkspaceRole(
      auth.user.role,
      "admin",
      "Inviting people needs the admin or owner role.",
    );
    if (denied) {
      void recordAuditEvent({
        workspaceId: id,
        action: AuditAction.MEMBER_INVITE,
        targetType: "invitation",
        result: "denied",
        ...actor,
        request,
      });
      return denied;
    }

    const parsed = InviteSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "An email address is required." }, { status: 400 });
    }

    const context = await appQueryOne<{ workspace_name: string; inviter_name: string | null }>(
      `SELECT w.name AS workspace_name,
              COALESCE(u.full_name, u.email) AS inviter_name
         FROM workspaces w
         LEFT JOIN app_users u ON u.id = $2::uuid
        WHERE w.id = $1::uuid`,
      [id, actor.actorId],
    );
    if (!context) {
      return NextResponse.json({ error: "That workspace no longer exists." }, { status: 404 });
    }

    const { invitation, token } = await createInvitation({
      workspaceId: id,
      email: parsed.data.email,
      role: parsed.data.role ?? "viewer",
      invitedBy: actor.actorId,
      inviterName: context.inviter_name ?? "A Vectorbea admin",
      workspaceName: context.workspace_name,
    });

    void recordAuditEvent({
      workspaceId: id,
      action: AuditAction.MEMBER_INVITE,
      targetType: "invitation",
      targetId: invitation.id,
      after: { email: invitation.email, role: invitation.role },
      ...actor,
      request,
    });

    // The raw token is returned ONCE, to the admin who created the invitation,
    // so the screen can offer a copyable link when mail is unavailable. It is
    // not stored and cannot be read back.
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    return NextResponse.json(
      { invitation, acceptUrl: `${appUrl}/auth/accept-invite?token=${token}` },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && /already|valid email|Ownership|pending/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const safe = toSafeApiError(error, "The invitation could not be created");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await assertWorkspaceMember(request, id);
    if (auth.error) return auth.error;

    const denied = requireWorkspaceRole(
      auth.user.role,
      "admin",
      "Revoking an invitation needs the admin or owner role.",
    );
    if (denied) return denied;

    const invitationId = request.nextUrl.searchParams.get("invitationId");
    if (!invitationId) {
      return NextResponse.json({ error: "invitationId is required" }, { status: 400 });
    }

    const revoked = await revokeInvitation(id, invitationId);

    void recordAuditEvent({
      workspaceId: id,
      action: AuditAction.MEMBER_INVITE_REVOKE,
      targetType: "invitation",
      targetId: revoked.id,
      before: { email: revoked.email, role: revoked.role },
      after: null,
      ...auditActor(auth.user),
      request,
    });

    return NextResponse.json(revoked);
  } catch (error) {
    if (error instanceof Error && /already been/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const safe = toSafeApiError(error, "The invitation could not be revoked");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
