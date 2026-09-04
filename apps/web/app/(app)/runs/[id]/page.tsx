import * as React from "react";
import { RunDetailView } from "~/components/app/run-detail/run-detail-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Run" };

/**
 * Run detail — three panes plus a log pane, not five tabs (design §10).
 *
 * Suspense is required: RunDetailView reads useSearchParams for the frozen and
 * demo-state flags, which opts the subtree into client rendering.
 */
export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <RunDetailView runId={id} />
    </React.Suspense>
  );
}
