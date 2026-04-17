"use client";

import { createBrowserClient } from "@supabase/ssr";
import { VECTORBEA_SCHEMA } from "@/lib/supabase-schema";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  throw new Error(
    "Missing environment variable: NEXT_PUBLIC_SUPABASE_URL\n" +
    "Add it to .env.local for local dev or to your Vercel project environment variables.",
  );
}

if (!SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY\n" +
    "Add it to .env.local for local dev or to your Vercel project environment variables.",
  );
}

const supabaseUrl = SUPABASE_URL as string;
const supabaseAnonKey = SUPABASE_ANON_KEY as string;

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    // PKCE flow: @supabase/ssr's createBrowserClient stores the code_verifier
    // in a cookie (not localStorage), so it survives the OAuth redirect and
    // can be read by the server-side /api/auth/callback Route Handler.
    // The handler calls exchangeCodeForSession(code) which internally reads
    // that cookie — no client-side token handling needed at all.
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, {
      auth: { flowType: "pkce" },
    });
  }
  return browserClient;
}

export function getVectorBeaBrowserClient() {
  return getSupabaseBrowserClient().schema(VECTORBEA_SCHEMA);
}
