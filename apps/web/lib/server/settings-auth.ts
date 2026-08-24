import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyToken } from "@/lib/auth/jwt";
import { getUserById } from "@/lib/auth/neon-auth";

/* ══════════════════════════════════════════════════════════════════════════════
   WHO IS ASKING

   `assertWorkspaceMember` answers "may this request touch this workspace" and
   is the right gate for everything workspace-scoped. Profile is not
   workspace-scoped: it belongs to a person, across every workspace they are in,
   so it needs the person and no tenant at all.

   IT ALSO DOES NOT HAVE A DEV BYPASS. `assertWorkspaceMember` short-circuits to
   a synthetic `mock-user` when `JWT_SECRET` is unset, which is the right call
   for reading a workspace on a laptop and the wrong one for writing to a row in
   `app_users` — there is no such user, and pretending otherwise would either
   fail obscurely or, worse, write somebody else's record. Without a real
   session this returns 401 and says why.
══════════════════════════════════════════════════════════════════════════════ */

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  fullName: string | null;
}

export type RequireUserResult =
  | { error: NextResponse; user?: never }
  | { error: null; user: AuthenticatedUser };

export async function requireAuthenticatedUser(
  request: NextRequest,
): Promise<RequireUserResult> {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value?.trim();
  const token = bearer || cookie || null;

  if (!token) {
    return {
      error: NextResponse.json(
        { error: "Sign in to change your profile.", code: "unauthenticated" },
        { status: 401 },
      ),
    };
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return {
      error: NextResponse.json(
        {
          error: process.env.JWT_SECRET
            ? "Your session has expired. Sign in again."
            : "Sessions are not configured in this environment (JWT_SECRET is unset), so there is no signed-in account to change.",
          code: "unauthenticated",
        },
        { status: 401 },
      ),
    };
  }

  const user = await getUserById(payload.sub);
  if (!user) {
    return {
      error: NextResponse.json(
        { error: "Your account could not be found.", code: "unauthenticated" },
        { status: 401 },
      ),
    };
  }

  return { error: null, user: { id: user.id, email: user.email, fullName: user.full_name } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The actor id to record in the audit trail, or null.
 *
 * `assertWorkspaceMember`'s dev bypass hands back the string `mock-user`, which
 * is not a user id. Recording it as one would put a fictional actor in the
 * governance trail; recording null with `actor_type: 'system'` is true.
 */
export function auditActor(user: { id?: string } | undefined | null): {
  actorType: "user" | "system";
  actorId: string | null;
} {
  const id = user?.id;
  return id && UUID.test(id)
    ? { actorType: "user", actorId: id }
    : { actorType: "system", actorId: null };
}
