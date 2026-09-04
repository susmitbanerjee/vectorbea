import * as React from "react";
import { IntegrationsView } from "~/components/app/connectivity/integrations-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Integrations" };

/**
 * A catalogue, and the one surface where a grid is the right shape (§10).
 *
 * Suspense is required, not stylistic: IntegrationsView reads useSearchParams
 * for its URL-synced category, detail and connect flow.
 */
export default function IntegrationsPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <IntegrationsView />
    </React.Suspense>
  );
}
