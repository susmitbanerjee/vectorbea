import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { recordUserScopedAuditEvent, AuditAction } from "@/lib/server/audit-write";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { requireAuthenticatedUser } from "@/lib/server/settings-auth";
import { changePassword, PROFILE_LIMITS } from "@/lib/server/user-profile";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   POST /api/settings/profile/password

   The current password is required even though the caller holds a valid
   session — see `changePassword`. A failure records a DENIED audit row: a run
   of failed password changes on an account is exactly the signal an
   investigation looks for, and a log that only records successes cannot show it.
══════════════════════════════════════════════════════════════════════════════ */

const BodySchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z
    .string()
    .min(PROFILE_LIMITS.PASSWORD_MIN, `Choose a password of at least ${PROFILE_LIMITS.PASSWORD_MIN} characters.`)
    .max(PROFILE_LIMITS.PASSWORD_MAX, "That password is too long."),
});

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser(request);
    if (auth.error) return auth.error;

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "That password is not valid." },
        { status: 400 },
      );
    }

    const result = await changePassword(
      auth.user.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );

    if (!result.ok) {
      void recordUserScopedAuditEvent(auth.user.id, {
        action: AuditAction.PASSWORD_CHANGE,
        targetType: "user",
        targetId: auth.user.id,
        actorType: "user",
        actorId: auth.user.id,
        result: "denied",
        after: { reason: result.reason },
        request,
      });

      if (result.reason === "no_password") {
        return NextResponse.json(
          {
            error:
              "This account signs in through an identity provider, so there is no password here to change. Change it with your provider instead.",
            code: "no_password",
          },
          { status: 409 },
        );
      }
      // "wrong password" and "no such account" collapse into one message so
      // this endpoint cannot be used to test whether an account exists.
      return NextResponse.json(
        { error: "That current password is not correct.", code: "wrong_password" },
        { status: 403 },
      );
    }

    void recordUserScopedAuditEvent(auth.user.id, {
      action: AuditAction.PASSWORD_CHANGE,
      targetType: "user",
      targetId: auth.user.id,
      actorType: "user",
      actorId: auth.user.id,
      request,
    });

    // No password material in the response, not even a masked form.
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && /password|characters|different/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const safe = toSafeApiError(error, "Your password could not be changed");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
