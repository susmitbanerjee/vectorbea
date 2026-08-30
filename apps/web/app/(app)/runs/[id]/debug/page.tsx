import * as React from "react";
import { DebugRunView } from "~/components/app/debug/debug-run-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Debug run" };

/**
 * The Debug tab, on its own route rather than inside the run detail page.
 *
 * Run detail is deliberately "panes, not tabs" (design §10): its three panes plus
 * the log pane exist so a timestamp in the log and the step it belongs to are
 * visible together, and adding a tab strip to it would undo that. The debugger is
 * a different mode of looking — one run, in depth, three views over the same span
 * tree — so it gets its own address, which is also linkable from an incident.
 */
export default async function DebugRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <DebugRunView runId={id} />
    </React.Suspense>
  );
}
