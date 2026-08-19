"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client.
 *
 * SCOPE: identity federation only. Never use this to authorise an API call.
 *
 * Supabase is not the session store in this product. The Kotlin API verifies
 * HS256 tokens signed with the shared `JWT_SECRET` (see api-kotlin
 * `JwtVerifier`) and has never accepted a Supabase access token.
 * `/api/auth/callback` exchanges the OAuth code, upserts the user into Neon,
 * mints our own JWT into an httpOnly cookie, and discards Supabase's.
 *
 * The token that authorises API calls comes from `~/lib/auth/token`.
 *
 * Note the OAuth *initiators* deliberately run server-side
 * (`app/api/auth/{github,google,microsoft}`): starting the flow from the browser
 * races the PKCE `code_verifier` cookie write against the navigation to the
 * provider, which fails the first attempt and succeeds on the second. This
 * client therefore has no part in the normal sign-in path — it exists for
 * client-side Supabase calls that do not involve our session.
 */
let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set to use Supabase from the browser.",
    );
  }

  cached = createBrowserClient(url, key);
  return cached;
}
