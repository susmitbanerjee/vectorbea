import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { recordUserScopedAuditEvent, AuditAction } from "@/lib/server/audit-write";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { requireAuthenticatedUser } from "@/lib/server/settings-auth";
import {
  getUserProfile,
  updateUserProfile,
  PROFILE_LIMITS,
} from "@/lib/server/user-profile";

export const dynamic = "force-dynamic";

/* ══════════════════════════════════════════════════════════════════════════════
   GET / PATCH /api/settings/profile

   The person, not the tenant. There is no `workspaceId` here on purpose: a
   profile is the same in every workspace somebody belongs to, and scoping it to
   one would create as many names for a person as they have memberships.

   `email` is readable and not writable — see `updateUserProfile` for why.
══════════════════════════════════════════════════════════════════════════════ */

const PatchSchema = z
  .object({
    fullName: z.string().max(PROFILE_LIMITS.FULL_NAME_MAX).nullable().optional(),
    avatarUrl: z.string().max(PROFILE_LIMITS.AVATAR_URL_MAX).nullable().optional(),
    timeZone: z.string().max(64).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Send at least one field to change.",
  });

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser(request, "see your profile");
    if (auth.error) return auth.error;

    const profile = await getUserProfile(auth.user.id);
    if (!profile) {
      return NextResponse.json({ error: "Your account could not be found." }, { status: 404 });
    }
    return NextResponse.json(profile);
  } catch (error) {
    const safe = toSafeApiError(error, "Your profile could not be loaded");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUser(request, "change your profile");
    if (auth.error) return auth.error;

    const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "That change is not valid." },
        { status: 400 },
      );
    }

    const before = await getUserProfile(auth.user.id);
    const after = await updateUserProfile(auth.user.id, parsed.data);

    // Profile edits are recorded against every workspace the person belongs to:
    // an audit log scoped to a workspace has to be able to answer "who changed
    // their display name" for the names it shows.
    void recordUserScopedAuditEvent(after.id, {
      action: AuditAction.PROFILE_UPDATE,
      targetType: "user",
      targetId: after.id,
      actorType: "user",
      actorId: after.id,
      before: before ? { fullName: before.fullName, avatarUrl: before.avatarUrl, timeZone: before.timeZone } : null,
      after: { fullName: after.fullName, avatarUrl: after.avatarUrl, timeZone: after.timeZone },
      request,
    });

    return NextResponse.json(after);
  } catch (error) {
    // Validation messages from `updateUserProfile` are written for the person
    // reading them, so they are returned as-is with a 400 rather than being
    // flattened into "internal error" by the generic mapper.
    if (error instanceof Error && /must be|Enter a full|too long|https/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const safe = toSafeApiError(error, "Your profile could not be saved");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
