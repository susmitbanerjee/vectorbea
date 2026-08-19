import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decodeJwt } from "jose";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { signToken, verifyToken } from "@/lib/auth/jwt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/token
 *
 * Hands the browser the access token for the current session so it can set
 * `Authorization: Bearer …` on cross-origin calls to the Kotlin API.
 *
 * Why this route has to exist
 * ───────────────────────────
 * The session cookie is httpOnly (correct — it is not XSS-readable) and the API
 * lives on a different origin (NEXT_PUBLIC_VECTORBEA_API_URL), so the cookie is
 * never sent with API requests. Something has to bridge that gap.
 *
 * The legacy layer bridges it by copying the token into a non-httpOnly
 * `vb-token-transfer` cookie and parking it in localStorage, which makes the
 * token permanently XSS-exfiltratable. This route replaces that: the token is
 * fetched same-origin on demand and held only in memory by the client
 * (`~/lib/auth/token`). Nothing durable stores it.
 *
 * Sliding renewal
 * ───────────────
 * Tokens are minted for 7 days. When fewer than RENEW_WITHIN_MS remain we mint a
 * fresh one and reset the cookie, so an active user is never logged out
 * mid-session. An inactive user's cookie simply expires. This is renewal of an
 * already-valid session, not an unbounded refresh: an expired or tampered cookie
 * verifies as invalid and gets 401.
 */

const RENEW_WITHIN_MS = 24 * 60 * 60 * 1000; // 1 day
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function expiryOf(token: string): number | null {
  try {
    const { exp } = decodeJwt(token);
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const cookieStore = await cookies();
  const current = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;

  if (!current) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "No session cookie." } },
      { status: 401 },
    );
  }

  const payload = await verifyToken(current);
  if (!payload) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Session token is invalid or expired." } },
      { status: 401 },
    );
  }

  const expiresAt = expiryOf(current);
  const needsRenewal = expiresAt !== null && expiresAt - Date.now() < RENEW_WITHIN_MS;

  if (!needsRenewal) {
    return NextResponse.json(
      {
        token: current,
        expiresAt,
        user: { id: payload.sub, email: payload.email },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const renewed = await signToken({ sub: payload.sub, email: payload.email, role: payload.role });

  const response = NextResponse.json(
    {
      token: renewed,
      expiresAt: expiryOf(renewed),
      user: { id: payload.sub, email: payload.email },
    },
    { headers: { "Cache-Control": "no-store" } },
  );

  response.cookies.set(AUTH_COOKIE_NAME, renewed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });

  return response;
}
