import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME, SESSION_ID_COOKIE_NAME } from "@/lib/auth/cookies";
import { upsertProfile } from "@/lib/auth/server";
import { createSupabaseAdminClient, createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google/callback
 *
 * Registered as the redirect URI in Google Cloud Console.
 * Google shows "vectorbea.com" on the consent screen because this is the
 * domain it redirects to — supabase.co is never visible to the user.
 *
 * Flow:
 *  1. Validate state (CSRF) and read code_verifier from cookie
 *  2. Exchange authorization code → Google access_token + id_token
 *  3. signInWithIdToken → Supabase creates/links the user
 *  4. Upsert profile, rotate session ID, set httpOnly cookies
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const returnedState = searchParams.get("state");
  const oauthError = searchParams.get("error");

  // Provider sent an error (e.g. user denied access)
  if (oauthError) {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }

  if (!code || !returnedState) {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }

  // ── Read + validate cookies ───────────────────────────────────────────────
  const cookieStore = await cookies();
  const codeVerifier = cookieStore.get("oauth_code_verifier")?.value;
  const savedState   = cookieStore.get("oauth_state")?.value;
  const next         = cookieStore.get("oauth_next")?.value ?? "/dashboard";

  // CSRF check
  if (!codeVerifier || !savedState || savedState !== returnedState) {
    console.error("[google/callback] state mismatch or missing verifier");
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  // ── Exchange code for tokens with Google ──────────────────────────────────
  const clientId     = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri  = `${origin}/api/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
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
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("[google/callback] token exchange failed:", body);
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  const tokenData = (await tokenRes.json()) as {
    id_token?: string;
    access_token?: string;
    error?: string;
  };

  if (!tokenData.id_token) {
    console.error("[google/callback] no id_token in Google response");
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  // ── Sign in to Supabase using the Google id_token ─────────────────────────
  // signInWithIdToken creates the user on first login and links on subsequent
  // logins (with "automatic identity linking" enabled in Supabase dashboard).
  const supabase = createSupabaseAdminClient();
  const { data, error: supabaseError } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: tokenData.id_token,
  });

  if (supabaseError || !data.session) {
    console.error("[google/callback] Supabase signInWithIdToken failed:", supabaseError?.message);
    return NextResponse.redirect(new URL("/login?error=callback_failed", request.url));
  }

  const { access_token, user } = data.session;

  // ── Persist profile + rotate session ID ──────────────────────────────────
  await upsertProfile(user);

  const sessionId = crypto.randomUUID();
  await createVectorBeaAdminClient()
    .from("profiles")
    .update({ current_session_id: sessionId })
    .eq("id", user.id);

  // ── Set session cookies + clear OAuth temp cookies ────────────────────────
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
  response.cookies.set(AUTH_COOKIE_NAME, access_token, cookieOptions);
  response.cookies.set(SESSION_ID_COOKIE_NAME, sessionId, cookieOptions);
  // Clean up the short-lived OAuth temp cookies
  response.cookies.set("oauth_code_verifier", "", expired);
  response.cookies.set("oauth_state", "", expired);
  response.cookies.set("oauth_next", "", expired);

  return response;
}
