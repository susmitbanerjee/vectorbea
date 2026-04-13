import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { getPostLoginRedirectForUser } from "@/lib/auth/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function persistProfile(user: {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
  } | null;
}) {
  const email = user.email?.trim();
  if (!email) {
    return;
  }

  const fullName =
    user.user_metadata?.full_name?.trim() ||
    user.user_metadata?.name?.trim() ||
    null;
  const avatarUrl =
    user.user_metadata?.avatar_url?.trim() ||
    user.user_metadata?.picture?.trim() ||
    null;

  const supabase = createVectorBeaAdminClient();
  await supabase.from("profiles").upsert(
    {
      id: user.id,
      email,
      full_name: fullName,
      avatar_url: avatarUrl,
    },
    { onConflict: "id" },
  );
}

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (!code) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const cookieStore = await cookies();

    // createServerClient reads the PKCE code_verifier from the cookies that
    // createBrowserClient wrote during signInWithOAuth — completing the flow.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          },
        },
      },
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.session?.access_token || !data.user) {
      throw error ?? new Error("Failed to exchange auth code for a session.");
    }

    await persistProfile({
      id: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata,
    });

    const { redirectTo } = await getPostLoginRedirectForUser(data.user.id);
    const response = NextResponse.redirect(new URL(redirectTo, request.url));

    // Set our own httpOnly session cookie for the app's auth checks.
    response.cookies.set(AUTH_COOKIE_NAME, data.session.access_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=oauth", request.url));
  }
}
