import "server-only";

import { createClient } from "@supabase/supabase-js";
import { VECTORBEA_SCHEMA } from "@/lib/supabase-schema";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createSupabaseAdminClient() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export function createVectorBeaAdminClient() {
  return createSupabaseAdminClient().schema(VECTORBEA_SCHEMA);
}
