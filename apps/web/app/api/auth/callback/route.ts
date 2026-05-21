import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { AUTH_COOKIE_NAME, SESSION_ID_COOKIE_NAME } from "@/lib/auth/cookies";
import { upsertProfile, getPostLoginRedirectForUser } from "@/lib/auth/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/callback
 *
 * Server-side PKCE exchange handler. This URL is registered as the OAuth
 * redirect URI in Google, Microsoft, and GitHub — replacing the old
 * Supabase project URL (wdbhcmrvzbnkwcglixbr.supabase.co). The OAuth
 * consent screen now shows your own domain instead of supabase.co.
 *
 * Flow
 * ────
 * 1. Provider (Google / Microsoft / GitHub) redirects here with ?code=...
 * 2. createServerClient reads the PKCE code_verifier from the cookie that
 *    @supabase/ssr stored in the browser before the OAuth redirect started.
 * 3. exchangeCodeForSession(code) verifies the code + verifier with Supabase,
 *    returning a fully validated session — no client-side token handling needed.
 * 4. We upsert the user profile, rotate the session ID for seat-sharing
 *    prevention, write our own httpOnly cookies, and redirect into the app.
 *
 * Error handling
 * ──────────────
 * Any failure redirects to /login?error=<reason> so the user sees a clear
 * message rather than a blank page or an uncaught exception.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  // `next` from the query string (Google / SSO deep-links) OR from the
  // oauth_next cookie (GitHub server-side flow, which can't carry query params
  // through the provider round-trip because the redirectTo has no next param).
  const cookieStore = await cookies();
  const cookieNext = cookieStore.get("oauth_next")?.value ?? null;
  const explicitNext = searchParams.get("next") ?? (cookieNext?.startsWith("/") ? cookieNext : null);

  // If there is no code param the user navigated here directly or the
  // provider sent an error — send them back to the login page.
  if (!code) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "oauth");
    return NextResponse.redirect(url);
  }

  // ── PKCE exchange ─────────────────────────────────────────────────────────
  // createServerClient needs read/write access to the request cookies so it
  // can find the code_verifier that was stored by the browser client during
  // signInWithOAuth, and then clear it after a successful exchange.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error("[auth/callback] PKCE exchange failed:", error?.message);
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "callback_failed");
    return NextResponse.redirect(url);
  }

  const { access_token, user } = data.session;

  // ── Persist profile ───────────────────────────────────────────────────────
  // On the very first login there is no profile row yet. upsertProfile is
  // idempotent so calling it on every login is safe.
  await upsertProfile(user);

  // ── Rotate session ID (seat-sharing prevention) ───────────────────────────
  const sessionId = crypto.randomUUID();

  await createVectorBeaAdminClient()
    .from("profiles")
    .update({ current_session_id: sessionId })
    .eq("id", user.id);

  // ── Resolve redirect destination ─────────────────────────────────────────
  // For first-time users (no workspace membership) send to /onboarding.
  // For returning users, send to their first workspace dashboard.
  // An explicit `next` query param overrides this (used by deep-link flows).
  let destination: string;
  if (explicitNext && explicitNext.startsWith("/")) {
    destination = explicitNext;
  } else {
    try {
      const { redirectTo } = await getPostLoginRedirectForUser(user.id);
      destination = redirectTo;
    } catch (err) {
      console.error("[auth/callback] post-login redirect lookup failed:", err);
      destination = "/dashboard";
    }
  }

  // ── Write httpOnly session cookies ────────────────────────────────────────
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  };

  const redirectUrl = new URL(destination, request.url);
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(AUTH_COOKIE_NAME, access_token, cookieOptions);
  response.cookies.set(SESSION_ID_COOKIE_NAME, sessionId, cookieOptions);
  // Clear the oauth_next cookie that the GitHub server-side flow stores
  response.cookies.set("oauth_next", "", { ...cookieOptions, maxAge: 0 });

  return response;
}
