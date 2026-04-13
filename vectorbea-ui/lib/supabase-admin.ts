import "server-only";

import { createClient } from "@supabase/supabase-js";
import { VECTORBEA_SCHEMA } from "@/lib/supabase-schema";

// NEXT_PUBLIC_SUPABASE_URL is also needed server-side.
// Reference it as a literal so Next.js static analysis can inline it.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("Missing environment variable: NEXT_PUBLIC_SUPABASE_URL");
}

if (!SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing environment variable: SUPABASE_SERVICE_ROLE_KEY\n" +
    "Add it to .env.local for local dev or to your Vercel project environment variables.\n" +
    "Find it in Supabase dashboard → Settings → API → service_role secret.",
  );
}

// TypeScript can't infer that the throws above narrow the type to string.
// Cast explicitly after the guards.
const supabaseUrl = SUPABASE_URL as string;
const serviceRoleKey = SERVICE_ROLE_KEY as string;

export function createSupabaseAdminClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function createVectorBeaAdminClient() {
  return createSupabaseAdminClient().schema(VECTORBEA_SCHEMA);
}
