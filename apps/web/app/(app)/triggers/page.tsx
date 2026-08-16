import * as React from "react";
import { TriggersView } from "~/components/app/connectivity/triggers-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Triggers" };

/**
 * Schedules, webhooks and manual starts unified (§10). Webhooks had nowhere to
 * live before this despite being a shipped feature.
 */
export default function TriggersPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <TriggersView />
    </React.Suspense>
  );
}
