import "server-only";

import { createClient } from "@supabase/supabase-js";

import { VECTORBEA_SCHEMA } from "@/lib/supabase-schema";

export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!serviceRoleKey) {
    throw new Error(
      "Missing environment variable: SUPABASE_SERVICE_ROLE_KEY\n" +
        "Add it to .env.local for local dev or to your Vercel project environment variables.\n" +
        "Find it in Supabase dashboard -> Settings -> API -> service_role secret.",
    );
  }

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
