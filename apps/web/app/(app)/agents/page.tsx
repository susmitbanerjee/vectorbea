import * as React from "react";
import { AgentsView } from "~/components/app/registry/agents-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Agents" };

/**
 * Agents — a registry table, not a card grid (design §1, diagnosis #2).
 *
 * Suspense is required, not stylistic: AgentsView reads useSearchParams for its
 * URL-synced query, sort and open record, which opts the subtree into client
 * rendering. Without a boundary the whole route deopts to dynamic.
 */
export default function AgentsPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <AgentsView />
    </React.Suspense>
  );
}
