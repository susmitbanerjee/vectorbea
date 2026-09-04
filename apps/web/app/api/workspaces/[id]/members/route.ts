import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { auditActor } from "@/lib/server/settings-auth";
import { listWorkspaceMembers } from "@/lib/server/workspace-members";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET /api/workspaces/:id/members

   Membership is read here and MUTATED at `./[userId]`, so the two cannot drift:
   one module (`lib/server/workspace-members.ts`) owns both, and the last-owner
   guard is part of the write rather than a rule the list happens to imply.

   This handler used to hand-roll the auth check — cookie, JWT, resolve the
   subject, query membership — a second implementation of
   `assertWorkspaceMember` that could disagree with the real one. It now uses
   the same gate as every other workspace route.
══════════════════════════════════════════════════════════════════════════════ */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: workspaceId } = await params;
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const members = await listWorkspaceMembers(workspaceId);
    const actor = auditActor(auth.user);

    return NextResponse.json({
      members,
      yourRole: auth.user.role,
      yourUserId: actor.actorId,
    });
  } catch (error) {
    const safe = toSafeApiError(error, "The member list could not be loaded");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
