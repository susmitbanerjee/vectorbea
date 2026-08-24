import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  assertWorkspaceMember,
  requireWorkspaceRole,
} from "@/lib/server/assert-workspace-member";
import { recordAuditEvent, AuditAction } from "@/lib/server/audit-write";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { auditActor } from "@/lib/server/settings-auth";
import {
  leaveWorkspace,
  MemberChangeError,
  parseRole,
  removeMember,
  updateMemberRole,
} from "@/lib/server/workspace-members";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   PATCH / DELETE /api/workspaces/:id/members/:userId

   REMOVING YOURSELF IS NOT AN ADMIN ACTION. A viewer must be able to leave a
   workspace they were added to; requiring admin to do it means the only way out
   is to ask the people you are trying to stop working with. So DELETE checks
   admin-or-owner only when the target is somebody else, and the two cases are
   recorded under different actions — `member.remove` and `member.leave` —
   because "was this person removed or did they go" is a different question.

   PROMOTING TO OWNER NEEDS OWNER. An admin who can mint owners can promote
   themselves, which makes the owner role decorative.

   THE LAST-OWNER GUARD IS NOT HERE. It lives inside the UPDATE's WHERE clause
   in `workspace-members.ts`, because a check in this handler loses the race
   between two simultaneous demotions.
══════════════════════════════════════════════════════════════════════════════ */

const PatchSchema = z.object({ role: z.string() });

function failureStatus(error: MemberChangeError): number {
  switch (error.reason) {
    case "not_a_member":
      return 404;
    case "unchanged":
      return 409;
    default:
      return 409;
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: workspaceId, userId } = await params;
  try {
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "A role is required." }, { status: 400 });

    let role;
    try {
      role = parseRole(parsed.data.role);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unknown role." },
        { status: 400 },
      );
    }

    const actor = auditActor(auth.user);
    const needed = role === "owner" ? "owner" : "admin";
    const denied = requireWorkspaceRole(
      auth.user.role,
      needed,
      role === "owner"
        ? "Only an owner can make somebody else an owner."
        : "Changing roles needs the admin or owner role.",
    );
    if (denied) {
      void recordAuditEvent({
        workspaceId,
        action: AuditAction.MEMBER_ROLE_CHANGE,
        targetType: "member",
        targetId: userId,
        after: { role },
        result: "denied",
        ...actor,
        request,
      });
      return denied;
    }

    const { before, after } = await updateMemberRole({ workspaceId, userId, role });

    void recordAuditEvent({
      workspaceId,
      action: AuditAction.MEMBER_ROLE_CHANGE,
      targetType: "member",
      targetId: userId,
      before: { role: before.role, email: before.email },
      after: { role: after.role, email: after.email },
      ...actor,
      request,
    });

    return NextResponse.json(after);
  } catch (error) {
    if (error instanceof MemberChangeError) {
      return NextResponse.json(
        { error: error.message, code: error.reason },
        { status: failureStatus(error) },
      );
    }
    const safe = toSafeApiError(error, "That role could not be changed");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id: workspaceId, userId } = await params;
  try {
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const actor = auditActor(auth.user);
    const isSelf = actor.actorId !== null && actor.actorId === userId;

    if (!isSelf) {
      const denied = requireWorkspaceRole(
        auth.user.role,
        "admin",
        "Removing somebody from this workspace needs the admin or owner role.",
      );
      if (denied) {
        void recordAuditEvent({
          workspaceId,
          action: AuditAction.MEMBER_REMOVE,
          targetType: "member",
          targetId: userId,
          result: "denied",
          ...actor,
          request,
        });
        return denied;
      }
    }

    if (isSelf) {
      const result = await leaveWorkspace({ workspaceId, userId });
      void recordAuditEvent({
        workspaceId,
        action: AuditAction.MEMBER_LEAVE,
        targetType: "member",
        targetId: userId,
        before: { role: result.member.role, email: result.member.email },
        after: null,
        ...actor,
        request,
      });
      return NextResponse.json({
        removed: true,
        left: true,
        remainingWorkspaces: result.remainingWorkspaces,
      });
    }

    const removed = await removeMember({ workspaceId, userId });
    void recordAuditEvent({
      workspaceId,
      action: AuditAction.MEMBER_REMOVE,
      targetType: "member",
      targetId: userId,
      before: { role: removed.role, email: removed.email },
      after: null,
      ...actor,
      request,
    });

    return NextResponse.json({ removed: true, left: false, member: removed });
  } catch (error) {
    if (error instanceof MemberChangeError) {
      return NextResponse.json(
        { error: error.message, code: error.reason },
        { status: failureStatus(error) },
      );
    }
    const safe = toSafeApiError(error, "That member could not be removed");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
