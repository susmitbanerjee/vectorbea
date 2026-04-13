"use client";

import { createBrowserClient } from "@supabase/ssr";
import { VECTORBEA_SCHEMA } from "@/lib/supabase-schema";

// Next.js inlines NEXT_PUBLIC_* vars at build time via static analysis.
// They MUST be referenced as literal identifiers — process.env[dynamicKey]
// always returns undefined for NEXT_PUBLIC_ vars in the browser bundle.
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
    // createBrowserClient stores the PKCE code_verifier in cookies (not
    // localStorage) so the server-side route handler can read it back
    // during the OAuth callback code exchange.
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return browserClient;
}

export function getVectorBeaBrowserClient() {
  return getSupabaseBrowserClient().schema(VECTORBEA_SCHEMA);
}
