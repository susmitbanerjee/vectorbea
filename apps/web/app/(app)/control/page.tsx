import * as React from "react";
import { ControlView } from "~/components/app/control/control-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Control" };

/**
 * Control — the renamed Overview (design §9, §10).
 *
 * "Control" rather than "Overview" because this is a control plane: the page's
 * job is to make the next action obvious, not to summarise yesterday.
 *
 * The Suspense boundary is required, not stylistic — ControlView reads
 * useSearchParams for its URL-synced range and sort, which opts the subtree into
 * client rendering. Without a boundary the whole route deopts to dynamic. The
 * fallback is the real skeleton, so the bail-out costs nothing visually.
 */
export default function ControlPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <ControlView />
    </React.Suspense>
  );
}
