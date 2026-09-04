import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/microsoft
 *
 * Initiates Microsoft OAuth with PKCE + nonce through your own domain.
 * The consent screen shows "vectorbea.com" instead of "supabase.co".
 *
 * Nonce encoding
 * ──────────────
 * Supabase's signInWithIdToken hashes the rawNonce you pass using SHA-256
 * and encodes the result as lowercase hex before comparing against the
 * id_token's nonce claim. The value sent to Azure as &nonce=... must therefore
 * also be hex(sha256(rawNonce)) — not base64url — so both sides agree.
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.AZURE_CLIENT_ID;
  const tenant   = process.env.AZURE_TENANT_ID ?? "common";

  if (!clientId) {
    return NextResponse.json({ error: "Microsoft OAuth not configured" }, { status: 500 });
  }

  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get("next") ?? "/control";

  // ── PKCE ──────────────────────────────────────────────────────────────────
  const verifierBytes  = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier   = Buffer.from(verifierBytes).toString("base64url");
  const challengeBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  const codeChallenge = Buffer.from(challengeBytes).toString("base64url");

  // ── Nonce ──────────────────────────────────────────────────────────────────
  // rawNonce  → stored in cookie, passed to signInWithIdToken
  // hashedNonce (hex) → sent to Azure, embedded by Azure in the id_token
  // Supabase hashes rawNonce → hex and compares with the token claim → match.
  const nonceBytes    = crypto.getRandomValues(new Uint8Array(16));
  const rawNonce      = Buffer.from(nonceBytes).toString("base64url");
  const nonceDigest   = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawNonce),
  );
  const hashedNonce = Array.from(new Uint8Array(nonceDigest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");   // lowercase hex — matches Supabase internal encoding

  // ── State (CSRF) ──────────────────────────────────────────────────────────
  const stateBytes = crypto.getRandomValues(new Uint8Array(16));
  const state      = Buffer.from(stateBytes).toString("base64url");

  // ── Build Microsoft authorization URL ─────────────────────────────────────
  const redirectUri = `${origin}/api/auth/microsoft/callback`;
  const authUrl = new URL(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
  );
  authUrl.searchParams.set("client_id",             clientId);
  authUrl.searchParams.set("redirect_uri",          redirectUri);
  authUrl.searchParams.set("response_type",         "code");
  authUrl.searchParams.set("response_mode",         "query");
  authUrl.searchParams.set("scope",                 "openid email profile offline_access");
  authUrl.searchParams.set("code_challenge",        codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("nonce",                 hashedNonce);  // hex hash
  authUrl.searchParams.set("state",                 state);

  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  };

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("oauth_code_verifier", codeVerifier, cookieOptions);
  response.cookies.set("oauth_nonce",         rawNonce,     cookieOptions);
  response.cookies.set("oauth_state",         state,        cookieOptions);
  response.cookies.set("oauth_next",          next,         cookieOptions);

  return response;
}
