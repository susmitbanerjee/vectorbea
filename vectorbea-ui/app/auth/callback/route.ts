import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import {
  getPostLoginRedirectForUser,
  upsertProfile,
} from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * OAuth PKCE callback handler.
 *
 * Supabase redirects here as:
 *   /auth/callback?code=<pkce_code>&next=/dashboard
 *
 * We must create the NextResponse *before* calling exchangeCodeForSession so
 * that the @supabase/ssr setAll() callback can write the Supabase session
 * cookies (sb-access-token, sb-refresh-token) directly onto the response
 * object. This is the only pattern that works in Next.js 15 App Router GET
 * handlers where the cookies() API is read-only.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // No code → likely a direct navigation or a failed OAuth start
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  // Build the redirect response first so we can write cookies onto it
  // below. The final destination is resolved after we know the user state.
  const response = NextResponse.redirect(`${origin}/dashboard`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // Read existing cookies from the incoming request
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write Supabase session cookies onto the outgoing response
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options ?? {});
          });
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error?.message);
    return NextResponse.redirect(`${origin}/login?error=callback_failed`);
  }

  const { session, user } = data;

  // Persist / update the vectorbea.profiles row so the app always has
  // a profile entry for this user regardless of trigger timing.
  await upsertProfile(user).catch((e) =>
    console.warn("[auth/callback] upsertProfile warning:", e),
  );

  // Set our application-level access-token cookie so that
  // getAuthenticatedUserFromCookies() works in server components and
  // middleware without needing to re-read the Supabase sb-* cookies.
  response.cookies.set(AUTH_COOKIE_NAME, session.access_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  // Resolve the correct post-login destination for this user
  // (onboarding if no workspace yet, otherwise /dashboard).
  const { redirectTo } = await getPostLoginRedirectForUser(user.id).catch(() => ({
    organizations: [],
    redirectTo: "/dashboard" as const,
  }));

  // Mutate the redirect target on the already-created response.
  // We can't return a new response here because the cookies set above
  // (via setAll) are attached to this specific response object.
  const destination = redirectTo ?? "/dashboard";
  response.headers.set("Location", `${origin}${destination}`);

  return response;
}
