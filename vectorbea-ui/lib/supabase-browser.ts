"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

function requirePublicEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required public environment variable: ${name}`);
  }
  return value;
}

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createClient(
      requirePublicEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requirePublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    );
  }

  return browserClient;
}
