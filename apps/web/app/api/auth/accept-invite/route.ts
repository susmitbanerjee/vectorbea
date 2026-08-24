import { NextRequest, NextResponse } from "next/server";

import { recordAuditEvent, AuditAction } from "@/lib/server/audit-write";
import { acceptInvitation } from "@/lib/server/invitations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { requireAuthenticatedUser } from "@/lib/server/settings-auth";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   POST /api/auth/accept-invite

   Called from /auth/accept-invite once the invitee is signed in.

   IT VERIFIES THE APPLICATION'S OWN SESSION. This called
   `supabase.auth.getUser(jwt)` — a Supabase-hosted auth service this product
   stopped using; sessions are the app's own HS256 tokens, verified by
   `lib/auth/jwt`. So every accept failed at the door with "invalid or expired
   session" regardless of the token presented, which made the whole invitation
   flow unusable end to end even where the rest of it worked.

   Accepting is deliberately open to any signed-in account. The token IS the
   authorisation — it is unguessable, single-use and expiring — and requiring
   membership first would make an invitation useless to the only people it is
   for.
══════════════════════════════════════════════════════════════════════════════ */

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser(request);
    if (auth.error) return auth.error;

    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = body.token?.trim();
    if (!token) return NextResponse.json({ error: "This link is missing its token." }, { status: 400 });

    const result = await acceptInvitation(token, auth.user.id);

    void recordAuditEvent({
      workspaceId: result.workspaceId,
      action: AuditAction.MEMBER_INVITE,
      targetType: "member",
      targetId: auth.user.id,
      after: { role: result.role, email: auth.user.email, accepted: true },
      actorType: "user",
      actorId: auth.user.id,
      request,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && /no longer valid/i.test(error.message)) {
      return NextResponse.json({ error: error.message, code: "invalid_invitation" }, { status: 410 });
    }
    const safe = toSafeApiError(error, "The invitation could not be accepted");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
