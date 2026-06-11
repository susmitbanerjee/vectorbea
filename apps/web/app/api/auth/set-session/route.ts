import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { verifyToken } from "@/lib/auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/set-session
 * Legacy endpoint kept for backward-compat. Verifies our local JWT and
 * re-sets the httpOnly cookie. Supabase OAuth flow removed.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { accessToken?: string };
    const accessToken = body?.accessToken;
    if (!accessToken) return NextResponse.json({ error: "accessToken is required" }, { status: 400 });

    const payload = await verifyToken(accessToken);
    if (!payload) return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTH_COOKIE_NAME, accessToken, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (e) {
    return NextResponse.json({ error: "Failed to set session" }, { status: 500 });
  }
}
