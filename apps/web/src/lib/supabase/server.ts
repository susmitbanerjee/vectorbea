import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Server Supabase client, reading and writing the request's cookie jar.
 *
 * Used by the OAuth initiators and the PKCE callback. As with the browser
 * client, this is identity federation only — the session the app runs on is our
 * own HS256 JWT in the `vectorbea-access-token` cookie.
 *
 * `cookieStore.set` throws when called from a Server Component (only route
 * handlers and Server Actions may mutate cookies). That is swallowed: in a
 * Server Component we only ever read, and the refresh path runs in a route
 * handler where the write does land.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.",
    );
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component render pass — read-only cookie jar. Safe to ignore.
        }
      },
    },
  });
}
