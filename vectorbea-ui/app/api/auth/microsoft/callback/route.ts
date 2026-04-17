import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, SESSION_ID_COOKIE_NAME } from "@/lib/auth/cookies";
import { upsertProfile } from "@/lib/auth/server";
import { createSupabaseAdminClient, createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/microsoft/callback
 *
 * Registered as the redirect URI in Azure Portal.
 * Microsoft shows "vectorbea.com" on the consent screen.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code          = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const oauthError    = searchParams.get("error");

  if (oauthError) {
    console.error(
      "[microsoft/callback] provider returned error:",
      oauthError,
      searchParams.get("error_description"),
    );
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }

  if (!code || !returnedState) {
    console.error("[microsoft/callback] missing code or state in query params");
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }

  // ── Read + validate cookies ────────────────────────────────────────────────
  const cookieStore  = await cookies();
  const codeVerifier = cookieStore.get("oauth_code_verifier")?.value;
  const savedState   = cookieStore.get("oauth_state")?.value;
  const rawNonce     = cookieStore.get("oauth_nonce")?.value;
  const next         = cookieStore.get("oauth_next")?.value ?? "/dashboard";

  if (!codeVerifier || !savedState) {
    console.error("[microsoft/callback] missing oauth cookies — possible cookie loss across redirect");
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  if (savedState !== returnedState) {
    console.error("[microsoft/callback] CSRF state mismatch");
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  if (!rawNonce) {
    console.error("[microsoft/callback] missing nonce cookie");
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  // ── Exchange code for tokens with Microsoft ────────────────────────────────
  const clientId     = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tenant       = process.env.AZURE_TENANT_ID ?? "common";
  const redirectUri  = `${origin}/api/auth/microsoft/callback`;

  if (!clientId || !clientSecret) {
    console.error("[microsoft/callback] AZURE_CLIENT_ID or AZURE_CLIENT_SECRET env var missing");
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    "authorization_code",
        code_verifier: codeVerifier,
      }),
    },
  );

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("[microsoft/callback] Microsoft token exchange failed:", tokenRes.status, body);
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  const tokenData = (await tokenRes.json()) as {
    id_token?: string;
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (tokenData.error || !tokenData.id_token) {
    console.error("[microsoft/callback] token response error:", tokenData.error, tokenData.error_description);
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  // ── Sign in to Supabase using the Microsoft id_token ──────────────────────
  // rawNonce is passed so Supabase can hash it (SHA-256 → hex) and verify it
  // against the nonce claim Azure embedded in the id_token.
  // access_token is included as some Supabase versions need it for Azure.
  const supabase = createSupabaseAdminClient();
  const { data, error: supabaseError } = await supabase.auth.signInWithIdToken({
    provider:     "azure",
    token:        tokenData.id_token,
    access_token: tokenData.access_token,
    nonce:        rawNonce,
  });

  if (supabaseError || !data.session) {
    console.error(
      "[microsoft/callback] Supabase signInWithIdToken failed:",
      supabaseError?.message ?? "no session returned",
      supabaseError?.status,
    );
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  const { access_token, user } = data.session;

  // ── Persist profile + rotate session ID ───────────────────────────────────
  await upsertProfile(user);

  const sessionId = crypto.randomUUID();
  await createVectorBeaAdminClient()
    .from("profiles")
    .update({ current_session_id: sessionId })
    .eq("id", user.id);

  // ── Set session cookies + clear all OAuth temp cookies ─────────────────────
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };

  const expired = { ...cookieOptions, maxAge: 0 };

  const redirectUrl = new URL(
    next.startsWith("/") ? next : "/dashboard",
    request.url,
  );

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(AUTH_COOKIE_NAME,       access_token, cookieOptions);
  response.cookies.set(SESSION_ID_COOKIE_NAME, sessionId,    cookieOptions);
  response.cookies.set("oauth_code_verifier",  "",           expired);
  response.cookies.set("oauth_nonce",          "",           expired);
  response.cookies.set("oauth_state",          "",           expired);
  response.cookies.set("oauth_next",           "",           expired);

  return response;
}
