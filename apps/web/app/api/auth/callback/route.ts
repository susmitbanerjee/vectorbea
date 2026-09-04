import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { signToken } from "@/lib/auth/jwt";
import { upsertOAuthUser } from "@/lib/auth/oauth-upsert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/callback
 *
 * Handles the OAuth redirect from GitHub / Google / Microsoft via Supabase PKCE.
 *
 * Supabase is used ONLY as an OAuth identity federation layer:
 *   1. Exchange OAuth code for Supabase session (get verified user email/name)
 *   2. Upsert that user into our Neon app_users table
 *   3. Issue our own HS256 JWT — this is what the app uses from here on
 *   4. Store our JWT in an httpOnly cookie and redirect to the dashboard
 *
 * Supabase's access_token is discarded after step 1 — we never store it.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const cookieStore = await cookies();
  const cookieNext = cookieStore.get("oauth_next")?.value ?? null;
  const explicitNext = searchParams.get("next") ?? (cookieNext?.startsWith("/") ? cookieNext : null);

  // ── 0. The provider refused before we ever got a code ─────────────────────
  // GitHub/Google/Microsoft all redirect back with ?error= when the user hits
  // "Cancel" on the consent screen, or when the OAuth app is misconfigured.
  // These are distinct situations and neither is our failure, so neither should
  // render as "sign-in did not complete".
  const providerError = searchParams.get("error");
  if (providerError) {
    const known = providerError === "access_denied" ? "access_denied" : "provider_error";
    console.warn("[auth/callback] provider returned an error:", {
      error: providerError,
      description: searchParams.get("error_description"),
    });
    return NextResponse.redirect(new URL(`/signin?error=${known}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/signin?error=oauth", request.url));
  }

  // ── 1. PKCE exchange with Supabase ────────────────────────────────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
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
    console.error("[auth/callback] PKCE exchange failed:", {
      message: error?.message,
      status: error?.status,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? "set" : "MISSING",
      supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "set" : "MISSING",
      code: code?.slice(0, 8) + "...",
    });

    // Separate the two exchange failures that mean different things to a user.
    // An expired code means they took too long or left the tab open; a reused
    // one usually means a refresh or a back-button on the callback URL. Both
    // are fixed by starting again, but only one of them is worth explaining as
    // "that link was already used".
    const detail = (error?.message ?? "").toLowerCase();
    const reason = detail.includes("expired")
      ? "code_expired"
      : detail.includes("already") || detail.includes("used") || detail.includes("invalid request")
        ? "code_used"
        : "callback_failed";

    return NextResponse.redirect(new URL(`/signin?error=${reason}`, request.url));
  }

  const oauthUser = data.session.user;
  const email    = oauthUser.email ?? "";
  const fullName = (oauthUser.user_metadata?.full_name as string | undefined)
    ?? (oauthUser.user_metadata?.name as string | undefined)
    ?? undefined;
  const avatarUrl = (oauthUser.user_metadata?.avatar_url as string | undefined)
    ?? (oauthUser.user_metadata?.picture as string | undefined)
    ?? undefined;

  // ── 2. Upsert into Neon app_users ─────────────────────────────────────────
  // Handles: new user, returning user same provider, same email different provider
  let jwtSub: string;
  try {
    jwtSub = await upsertOAuthUser(oauthUser.id, email, fullName, avatarUrl);
  } catch (err) {
    console.error("[auth/callback] Neon upsert failed:", err);
    return NextResponse.redirect(new URL("/signin?error=callback_failed", request.url));
  }

  // ── 3. Issue our own JWT ──────────────────────────────────────────────────
  const ourToken = await signToken({ sub: jwtSub, email });

  // ── 4. Redirect with our JWT cookie ──────────────────────────────────────
  const destination = explicitNext?.startsWith("/") ? explicitNext : "/control";
  const cookieOpts = {
    httpOnly: true, sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 60 * 60 * 24 * 7,
  };

  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(AUTH_COOKIE_NAME, ourToken, cookieOpts);
  // Also expose the token via a short-lived readable cookie so the client can
  // store it in localStorage for Kotlin API Authorization headers.
  // This cookie is NOT httpOnly so JS can read and move it to localStorage.
  response.cookies.set("vb-token-transfer", ourToken, {
    ...cookieOpts, httpOnly: false, maxAge: 60,  // expires in 60 seconds
  });
  response.cookies.set("oauth_next", "", { ...cookieOpts, maxAge: 0 });

  return response;
}
