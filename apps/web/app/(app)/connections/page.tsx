import * as React from "react";
import { ConnectionsView } from "~/components/app/connectivity/connections-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Connections" };

/**
 * The operational view, sorted broken-first — this page is opened during an
 * incident (§10).
 */
export default function ConnectionsPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <ConnectionsView />
    </React.Suspense>
  );
}
