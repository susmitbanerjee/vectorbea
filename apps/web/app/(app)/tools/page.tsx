import * as React from "react";
import { ToolsView } from "~/components/app/registry/tools-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Tools" };

/**
 * Tools — a registry table, riskiest first (design §1, diagnosis #2).
 *
 * Suspense is required, not stylistic: ToolsView reads useSearchParams for its
 * URL-synced query, sort and open record, which opts the subtree into client
 * rendering. Without a boundary the whole route deopts to dynamic.
 */
export default function ToolsPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <ToolsView />
    </React.Suspense>
  );
}
