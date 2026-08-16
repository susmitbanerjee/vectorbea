import * as React from "react";
import { UsageView } from "~/components/app/admin/usage-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Usage & limits" };

/**
 * The forecast is the addition (§10). A limits page that only reports current
 * state makes people discover their limits by hitting them.
 */
export default function UsagePage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <UsageView />
    </React.Suspense>
  );
}
