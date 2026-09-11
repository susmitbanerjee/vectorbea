import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyToken } from "@/lib/auth/jwt";
import { AuditAction, recordUserScopedAuditEvent } from "@/lib/server/audit-write";
import {
  getAuthenticatedUserFromCookies,
  getPostLoginRedirectForUser,
  loadProfileForUser,
} from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who is signed in, and where they belong.
 *
 * Read by the marketing nav to decide between "Sign in / Start free" and the
 * account avatar. 401 is the honest answer for a visitor with no session and is
 * what makes the landing page fall back cleanly — it is not an error.
 *
 * THE PROFILE LOOKUP MUST NOT DECIDE WHETHER YOU ARE SIGNED IN. Both calls
 * below reach the database, and they used to sit in a bare `Promise.all`: a
 * transient database fault turned a perfectly valid session into a 500, which
 * every caller reads as "not signed in". The session is proven by the verified
 * cookie above and nothing else; the name, the picture and the workspace-scoped
 * landing path are decoration on top of it, and a decoration that fails degrades
 * to the plain answer.
 */
export async function GET() {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

  if (!user) {
    return NextResponse.json({ authenticated: false, redirectTo: "/login" }, { status: 401 });
  }

  const [redirect, profile] = await Promise.all([
    getPostLoginRedirectForUser(user.id).catch(() => null),
    loadProfileForUser(user.id).catch(() => null),
  ]);

  return NextResponse.json({
    authenticated: true,
    // /control is the landing surface for an account whose workspaces could not
    // be read; it resolves the workspace itself.
    redirectTo: redirect?.redirectTo ?? "/control",
    user: {
      id:       user.id,
      email:    user.email,
      fullName: profile?.full_name ?? null,
      avatarUrl:profile?.avatar_url ?? null,
    },
  });
}

export async function DELETE(request: NextRequest) {
  /*
   * Read the session BEFORE clearing it — after the cookie is gone there is no
   * identity to file the entry against, and "who signed out" is half of the
   * session-duration question an access review asks.
   *
   * Best-effort in both directions: a sign-out is never refused because the
   * audit write failed, and an unauthenticated DELETE records nothing rather
   * than inventing an actor.
   */
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (payload?.sub) {
    await recordUserScopedAuditEvent(payload.sub, {
      action: AuditAction.LOGOUT,
      targetType: "session",
      request,
    });
  }

  const expired = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 };
  const res = NextResponse.json({ authenticated: false });
  res.cookies.set(AUTH_COOKIE_NAME, "", expired);
  return res;
}
