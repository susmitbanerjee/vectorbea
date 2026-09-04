import * as React from "react";
import { RunsView } from "~/components/app/runs/runs-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Runs" };

/**
 * Runs — the run list (design §10).
 *
 * Suspense is required, not stylistic: RunsView reads useSearchParams for its
 * URL-synced query, sort and range, which opts the subtree into client
 * rendering. Without a boundary the whole route deopts to dynamic.
 */
export default function RunsPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <RunsView />
    </React.Suspense>
  );
}
