import "server-only";
import { createClient } from "@supabase/supabase-js";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

/**
 * Service-role Supabase client scoped to the vectorbea schema.
 * Used exclusively for server-side data fetching; never exposed to the browser.
 */
export function db() {
  return createClient(url!, key!, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).schema("vectorbea");
}

/** Raw client without schema override — for cross-schema queries. */
export function rawDb() {
  return createClient(url!, key!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
