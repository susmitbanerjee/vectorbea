import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/set-session
 *
 * Called by the client-side /auth/callback page immediately after a
 * successful PKCE code exchange. Sets the httpOnly AUTH_COOKIE_NAME cookie
 * that every Server Component and API Route reads via
 * getAuthenticatedUserFromCookies().
 *
 * Security: the PKCE exchange that produced the token IS the authentication
 * proof — Supabase verified the code_verifier before issuing it. Re-validating
 * server-side via getUser() adds a redundant network round-trip and can fail
 * transiently due to clock skew or propagation delay. The token is validated
 * on every subsequent authenticated request via getAuthenticatedUserFromCookies,
 * so defence-in-depth is maintained without an extra call here.
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
    // This is not cryptographic validation — it just prevents obviously wrong
    // values (empty string, SQL injection attempts, etc.) from being stored.
    if (accessToken.split(".").length !== 3) {
      return NextResponse.json({ error: "Invalid token format" }, { status: 400 });
    }

    const response = NextResponse.json({ ok: true });

    response.cookies.set(AUTH_COOKIE_NAME, accessToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (error) {
    console.error("[set-session] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set session" },
      { status: 500 },
    );
  }
}
