import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google
 *
 * Initiates Google OAuth with PKCE entirely through your own domain.
 * Google's consent screen shows "vectorbea.com" instead of "supabase.co"
 * because the redirect_uri registered in Google Console is your own callback.
 *
 * Query params:
 *   next  — where to send the user after successful sign-in (optional)
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 500 });
  }

  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get("next") ?? "/control";

  // ── PKCE ─────────────────────────────────────────────────────────────────
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = Buffer.from(verifierBytes).toString("base64url");

  const challengeBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = Buffer.from(challengeBytes).toString("base64url");

  // ── State (CSRF) ──────────────────────────────────────────────────────────
  const stateBytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Buffer.from(stateBytes).toString("base64url");

  // ── Build Google authorization URL ───────────────────────────────────────
  const redirectUri = `${origin}/api/auth/google/callback`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "select_account");

  // Store verifier + state + next destination in short-lived httpOnly cookies.
  // They are read by the callback route and deleted immediately after use.
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10, // 10 minutes — more than enough for the OAuth round-trip
  };

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("oauth_code_verifier", codeVerifier, cookieOptions);
  response.cookies.set("oauth_state", state, cookieOptions);
  response.cookies.set("oauth_next", next, cookieOptions);

  return response;
}
