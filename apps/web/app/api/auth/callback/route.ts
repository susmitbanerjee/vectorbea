import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { signToken } from "@/lib/auth/jwt";
import { createUser, getUserWorkspaces } from "@/lib/auth/neon-auth";
import { neon } from "@neondatabase/serverless";

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
    return NextResponse.redirect(new URL("/signin?error=callback_failed", request.url));
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
  // Uses neon() HTTP client — more reliable than Pool on serverless/Railway.
  let neonUserId: string;
  try {
    const sql = neon(process.env.DATABASE_URL!);

    const userRows = await sql`
      INSERT INTO app_users (supabase_user_id, email, full_name, avatar_url, status, email_verified)
      VALUES (${oauthUser.id}, ${email}, ${fullName ?? null}, ${avatarUrl ?? null}, 'active', TRUE)
      ON CONFLICT (supabase_user_id) DO UPDATE
        SET email      = COALESCE(EXCLUDED.email,      app_users.email),
            full_name  = COALESCE(EXCLUDED.full_name,  app_users.full_name),
            avatar_url = COALESCE(EXCLUDED.avatar_url, app_users.avatar_url),
            updated_at = now()
      RETURNING id`;

    neonUserId = userRows[0]!.id;

    // Auto-create workspace if the user has none
    const workspaces = await getUserWorkspaces(neonUserId);
    if (workspaces.length === 0) {
      const slug = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 40);
      const wsName = `${fullName ?? email.split("@")[0]}'s Workspace`;

      const wsRows = await sql`
        INSERT INTO workspaces (name, slug, owner_user_id)
        VALUES (${wsName}, ${slug}, ${neonUserId})
        ON CONFLICT (slug) DO UPDATE SET slug = ${slug} || '-' || substr(md5(random()::text), 1, 6)
        RETURNING id`;
      const wsId = wsRows[0]!.id;

      await sql`INSERT INTO environments (workspace_id, name, slug, type)
        VALUES (${wsId}, 'Development', 'development', 'development') ON CONFLICT DO NOTHING`;

      await sql`INSERT INTO workspace_members (workspace_id, user_id, role, status)
        VALUES (${wsId}, ${neonUserId}, 'owner', 'active') ON CONFLICT DO NOTHING`;
    }
  } catch (err) {
    console.error("[auth/callback] Neon upsert failed:", err);
    return NextResponse.redirect(new URL("/signin?error=callback_failed", request.url));
  }

  // ── 3. Issue our own JWT ──────────────────────────────────────────────────
  const ourToken = await signToken({ sub: neonUserId, email });

  // ── 4. Redirect with our JWT cookie ──────────────────────────────────────
  const destination = explicitNext?.startsWith("/") ? explicitNext : "/dashboard";
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
