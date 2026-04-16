import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import {
  getAuthenticatedUserForAccessToken,
  upsertProfile,
} from "@/lib/auth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/set-session
 *
 * Called by the client-side /auth/callback page immediately after a
 * successful PKCE code exchange. Validates the access token server-side,
 * then sets the httpOnly AUTH_COOKIE_NAME cookie that every Server Component
 * and API Route reads via getAuthenticatedUserFromCookies().
 *
 * Body: { accessToken: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { accessToken } = (await request.json()) as { accessToken?: string };

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json({ error: "accessToken is required" }, { status: 400 });
    }

    // Validate the token is genuine before trusting it
    const user = await getAuthenticatedUserForAccessToken(accessToken);
    if (!user) {
      return NextResponse.json({ error: "Invalid access token" }, { status: 401 });
    }

    // Best-effort profile upsert (non-fatal)
    await upsertProfile(user).catch((e) =>
      console.warn("[set-session] upsertProfile warning:", e),
    );

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
