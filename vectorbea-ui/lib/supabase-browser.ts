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
    // Use implicit flow so the session is delivered via the URL hash fragment.
    // PKCE requires the code_verifier to survive an OAuth redirect, but
    // @supabase/ssr's createBrowserClient stores it in localStorage which is
    // wiped between page navigations in some environments, breaking the
    // exchange. Implicit flow has no code_verifier — the access_token arrives
    // in the hash and is immediately available to the callback page.
    browserClient = createBrowserClient(supabaseUrl, supabaseAnonKey, {
      auth: { flowType: "implicit" },
    });
  }
  return browserClient;
}

export function getVectorBeaBrowserClient() {
  return getSupabaseBrowserClient().schema(VECTORBEA_SCHEMA);
}
