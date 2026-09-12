import * as React from "react";
import { ApiKeysView } from "~/components/app/settings/api-keys-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "API keys" };

/**
 * API keys.
 *
 * ── WHY THIS ROUTE MOVED OFF THE LEGACY CLIENT ────────────────────────────
 * The previous page read and wrote a Supabase `api_keys` table through
 * `createVectorBeaAdminClient`. That schema is dead in every environment (see
 * /docs/audit/CURRENT-STATE.md), so the list was always empty and "Create"
 * returned a key that authenticated nothing — the API validates against a
 * Postgres table those rows never reached.
 *
 * The live store is `ApiKeyRoutes` / `ApiKeyService`, which is the same table
 * `authenticate()` reads. That is the only property that makes an issued key
 * actually open anything.
 *
 * `components/api-keys/api-keys-client.tsx` and `/app/api/keys/*` are left in
 * place: this is a screen-by-screen migration, and deleting a legacy component
 * is a separate decision from routing around it.
 */
export default function ApiKeysPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <ApiKeysView />
    </React.Suspense>
  );
}
