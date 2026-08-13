import * as React from "react";
import { WorkflowsView } from "~/components/app/workflows/workflows-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Workflows" };

/**
 * Workflows — the list (design §10).
 *
 * Suspense is required, not stylistic: WorkflowsView reads useSearchParams for
 * its URL-synced query and sort, which opts the subtree into client rendering.
 * Without a boundary the whole route deopts to dynamic.
 */
export default function WorkflowsPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <WorkflowsView />
    </React.Suspense>
  );
}
