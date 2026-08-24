import { NextRequest, NextResponse } from "next/server";

import { recordAuditEvent, AuditAction } from "@/lib/server/audit-write";
import { acceptInvitation, previewInvitation } from "@/lib/server/invitations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { requireAuthenticatedUser } from "@/lib/server/settings-auth";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET / POST /api/auth/accept-invite

   IT VERIFIES THE APPLICATION'S OWN SESSION. This called
   `supabase.auth.getUser(jwt)` — a Supabase-hosted auth service this product
   stopped using; sessions are the app's own HS256 tokens, verified by
   `lib/auth/jwt`. So every accept failed at the door regardless of the token
   presented, and the page rendered that as "this invitation has expired".

   GET PREVIEWS, POST REDEEMS, and the split matters. Redeeming is single-use
   and irreversible, so it must be an explicit act by a signed-in person — never
   a side effect of opening a URL. The old page POSTed on mount, which puts a
   one-shot token at the mercy of anything that opens the link first: a mail
   gateway's link scanner, a browser prefetch, a preview pane. The invitee then
   arrives at a link that has already been used.

   ACCEPTANCE IS BOUND TO THE INVITED ADDRESS. Any signed-in account could
   previously redeem any link. An invitation addressed to alice@ that bob@ can
   spend is a way into a tenant, so the emails must match — and when they do
   not, the response says which address to sign in as rather than reporting the
   invitation as broken.
══════════════════════════════════════════════════════════════════════════════ */

/** One sentence per reason, so the page never has to guess or list them all. */
const INVALID_REASON: Record<string, string> = {
  expired: "This invitation has expired. Ask for a new one — they last 72 hours.",
  accepted: "This invitation has already been used. If that was you, sign in and switch workspaces.",
  revoked: "This invitation was revoked by a workspace admin. Ask them to send a new one.",
  unknown: "This invitation link is not valid. Check you copied the whole link, or ask for a new one.",
};

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token")?.trim();
    if (!token) {
      return NextResponse.json(
        { valid: false, reason: "unknown", message: INVALID_REASON.unknown },
        { status: 400 },
      );
    }

    const preview = await previewInvitation(token);
    if (!preview.valid) {
      return NextResponse.json(
        { valid: false, reason: preview.reason, message: INVALID_REASON[preview.reason] },
        { status: 200 },
      );
    }

    // Who is looking, so the page can offer the right next step without a
    // second round trip. Not being signed in is a state, not an error here.
    const auth = await requireAuthenticatedUser(request);
    const viewer = auth.error ? null : auth.user;

    return NextResponse.json({
      valid: true,
      workspaceName: preview.workspaceName,
      role: preview.role,
      inviterName: preview.inviterName,
      invitedEmail: preview.email,
      expiresAt: preview.expiresAt,
      viewer: viewer ? { email: viewer.email } : null,
      emailMatches: viewer
        ? (viewer.email ?? "").toLowerCase() === preview.email.toLowerCase()
        : null,
    });
  } catch (error) {
    const safe = toSafeApiError(error, "This invitation could not be read");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = body.token?.trim();
    if (!token) return NextResponse.json({ error: "This link is missing its token." }, { status: 400 });

    const auth = await requireAuthenticatedUser(request, "accept this invitation");
    if (auth.error) return auth.error;

    const preview = await previewInvitation(token);
    if (!preview.valid) {
      return NextResponse.json(
        { error: INVALID_REASON[preview.reason], code: preview.reason },
        { status: 410 },
      );
    }

    if ((auth.user.email ?? "").toLowerCase() !== preview.email.toLowerCase()) {
      return NextResponse.json(
        {
          error: `This invitation was sent to ${preview.email}, but you are signed in as ${auth.user.email ?? "another account"}. Sign in as ${preview.email} to accept it.`,
          code: "email_mismatch",
          invitedEmail: preview.email,
        },
        { status: 409 },
      );
    }

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
      return NextResponse.json({ error: error.message, code: "unknown" }, { status: 410 });
    }
    const safe = toSafeApiError(error, "The invitation could not be accepted");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
