import * as React from "react";
import { TemplatesView } from "~/components/app/templates/templates-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Templates" };

/**
 * Suspense is required, not stylistic: TemplatesView reads useSearchParams for
 * its URL-synced filters, preview and use-flow, which opts the subtree into
 * client rendering. Without a boundary the whole route deopts to dynamic.
 */
export default function TemplatesPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <TemplatesView />
    </React.Suspense>
  );
}
