import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, SESSION_ID_COOKIE_NAME } from "@/lib/auth/cookies";
import { getAuthenticatedUserForAccessToken } from "@/lib/auth/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/set-session
 *
 * Called by the client-side /auth/callback page immediately after a
 * successful implicit-flow OAuth redirect. Sets two httpOnly cookies:
 *
 *   AUTH_COOKIE_NAME  — the Supabase access token read by every Server
 *                       Component and API Route.
 *   SESSION_ID_COOKIE — a fresh UUID that is ALSO written to
 *                       vectorbea.profiles.current_session_id. Middleware
 *                       compares the cookie against the DB value on every
 *                       protected request. If they differ (login on another
 *                       device rotated the DB value), the old session is
 *                       immediately killed → seat-sharing prevention.
 *
 * Body: { accessToken: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { accessToken?: unknown };
    const accessToken = body?.accessToken;

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
    }

    // Sanity-check: a Supabase JWT has three dot-separated base64 segments.
    if (accessToken.split(".").length !== 3) {
      return NextResponse.json({ error: "Invalid token format" }, { status: 400 });
    }

    // Verify the token with Supabase to get the authenticated user.
    // We need the user ID to update current_session_id in the profiles table.
    const user = await getAuthenticatedUserForAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    // ── Rotate session ID (seat-sharing prevention) ───────────────────────
    // Generate a fresh UUID for this login event. Writing it to the DB
    // immediately invalidates any other device's vb_session_id cookie —
    // middleware will detect the mismatch on their next page load.
    const sessionId = crypto.randomUUID();

    await createVectorBeaAdminClient()
      .from("profiles")
      .update({ current_session_id: sessionId })
      .eq("id", user.id);

    // ── Write httpOnly cookies ────────────────────────────────────────────
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days — matches access token lifetime
    };

    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTH_COOKIE_NAME, accessToken, cookieOptions);
    response.cookies.set(SESSION_ID_COOKIE_NAME, sessionId, cookieOptions);

    return response;
  } catch (error) {
    console.error("[set-session] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set session" },
      { status: 500 },
    );
  }
}
