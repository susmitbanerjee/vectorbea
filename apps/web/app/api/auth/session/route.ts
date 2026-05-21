import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, SESSION_ID_COOKIE_NAME } from "@/lib/auth/cookies";
import {
  getAuthenticatedUserForAccessToken,
  getAuthenticatedUserFromCookies,
  getPostLoginRedirectForUser,
  loadProfileForUser,
  upsertProfile,
} from "@/lib/auth/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

  if (!user) {
    return NextResponse.json(
      { authenticated: false, redirectTo: "/login" },
      { status: 401 },
    );
  }

  const [{ redirectTo }, profile] = await Promise.all([
    getPostLoginRedirectForUser(user.id),
    loadProfileForUser(user.id),
  ]);
  return NextResponse.json({
    authenticated: true,
    redirectTo,
    user: {
      id: user.id,
      email: user.email ?? null,
      fullName: profile?.full_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as { accessToken?: string };
    const accessToken = payload.accessToken?.trim();

    if (!accessToken) {
      return NextResponse.json(
        { error: "accessToken is required" },
        { status: 400 },
      );
    }

    const user = await getAuthenticatedUserForAccessToken(accessToken);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid Supabase session" },
        { status: 401 },
      );
    }

    // Persist profile on first login (implicit flow has no server callback).
    await upsertProfile(user);

    // ── Rotate session ID (seat-sharing prevention) ───────────────────────
    const sessionId = crypto.randomUUID();
    await createVectorBeaAdminClient()
      .from("profiles")
      .update({ current_session_id: sessionId })
      .eq("id", user.id);

    const [{ redirectTo }, profile] = await Promise.all([
      getPostLoginRedirectForUser(user.id),
      loadProfileForUser(user.id),
    ]);

    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    };

    const response = NextResponse.json({
      authenticated: true,
      redirectTo,
      user: {
        id: user.id,
        email: user.email ?? null,
        fullName: profile?.full_name ?? null,
        avatarUrl: profile?.avatar_url ?? null,
      },
    });

    response.cookies.set(AUTH_COOKIE_NAME, accessToken, cookieOptions);
    response.cookies.set(SESSION_ID_COOKIE_NAME, sessionId, cookieOptions);

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to establish auth session",
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  // Attempt to clear current_session_id in the DB so the old UUID
  // can never be re-used to pass the middleware concurrency check.
  // This is best-effort — failure does not block the logout response.
  try {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);
    if (user) {
      await createVectorBeaAdminClient()
        .from("profiles")
        .update({ current_session_id: null })
        .eq("id", user.id);
    }
  } catch {
    // Swallow — the cookie deletion below is the authoritative logout action.
  }

  const expiredOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };

  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(AUTH_COOKIE_NAME, "", expiredOptions);
  response.cookies.set(SESSION_ID_COOKIE_NAME, "", expiredOptions);
  return response;
}
