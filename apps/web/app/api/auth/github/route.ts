import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/github
 *
 * Server-side GitHub OAuth initiator.
 *
 * Why server-side?
 * ────────────────
 * The client-side supabase.auth.signInWithOAuth() writes the PKCE
 * code_verifier to document.cookie and *immediately* navigates to GitHub.
 * On the very first visit the browser has not yet committed that cookie
 * before the navigation fires, so the callback receives no verifier and
 * fails with "callback_failed".  On a second attempt the prior cookie is
 * already present, which is why the second click always succeeds.
 *
 * By generating the PKCE pair server-side and setting cookies in the HTTP
 * response headers (before the redirect), we guarantee the browser stores
 * the verifier atomically with following the redirect — no race condition.
 *
 * Flow
 * ────
 * 1. Generate PKCE code_verifier + code_challenge + state server-side
 * 2. Ask Supabase for the GitHub authorization URL (skipBrowserRedirect)
 * 3. Set all PKCE cookies in the redirect response headers
 * 4. Redirect to GitHub — cookies are guaranteed to be in place when
 *    GitHub redirects back to /api/auth/callback
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const next = searchParams.get("next") ?? "/control";

  const cookieStore = await cookies();

  // Collect any cookies Supabase wants to set (PKCE verifier etc.)
  const pendingCookies: Array<{
    name: string;
    value: string;
    options: Record<string, unknown>;
  }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const c of cookiesToSet) {
            pendingCookies.push(c as typeof pendingCookies[number]);
          }
        },
      },
    },
  );

  // skipBrowserRedirect: true → supabase returns the URL without navigating,
  // and writes the PKCE verifier via the setAll cookie callback above.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${origin}/api/auth/callback`,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    console.error("[auth/github] failed to get OAuth URL:", error?.message);
    return NextResponse.redirect(new URL("/signin?error=oauth", request.url));
  }

  // httpOnly + lax is correct for the PKCE round-trip:
  // the verifier is set here (same-site) and read back when GitHub
  // does a top-level GET redirect to our callback (lax allows that).
  const cookieDefaults = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10, // 10 minutes — more than enough for the OAuth round-trip
  };

  const response = NextResponse.redirect(data.url);

  // Write all PKCE cookies onto the redirect response (atomic with navigation)
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, { ...cookieDefaults, ...options });
  }

  // Store the post-login destination so the callback can redirect there
  response.cookies.set("oauth_next", next, cookieDefaults);

  return response;
}
