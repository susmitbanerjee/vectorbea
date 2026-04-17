import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/microsoft
 *
 * Initiates Microsoft OAuth with PKCE through your own domain.
 * The consent screen shows "vectorbea.com" instead of "supabase.co".
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.AZURE_CLIENT_ID;
  const tenant   = process.env.AZURE_TENANT_ID ?? "common";

  if (!clientId) {
    return NextResponse.json({ error: "Microsoft OAuth not configured" }, { status: 500 });
  }

  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get("next") ?? "/dashboard";

  // ── PKCE ─────────────────────────────────────────────────────────────────
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier  = Buffer.from(verifierBytes).toString("base64url");

  const challengeBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = Buffer.from(challengeBytes).toString("base64url");

  // ── State (CSRF) ──────────────────────────────────────────────────────────
  const stateBytes = crypto.getRandomValues(new Uint8Array(16));
  const state = Buffer.from(stateBytes).toString("base64url");

  // ── Build Microsoft authorization URL ────────────────────────────────────
  const redirectUri = `${origin}/api/auth/microsoft/callback`;
  const authUrl = new URL(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
  );
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("response_mode", "query");
  authUrl.searchParams.set("scope", "openid email profile offline_access");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);

  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  };

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("oauth_code_verifier", codeVerifier, cookieOptions);
  response.cookies.set("oauth_state", state, cookieOptions);
  response.cookies.set("oauth_next", next, cookieOptions);

  return response;
}
