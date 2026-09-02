import * as React from "react";
import { PageContainer } from "~/components/ui/page";
import { FailuresPage } from "~/components/app/failures/failures-page";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Failures" };

/**
 * Failures — the taxonomy as an operating picture.
 *
 * A peer of Incidents, not a duplicate of it. Incidents groups by failure
 * SIGNATURE and carries a workflow — acknowledge, resolve, mute — because its
 * question is "is anyone on this". This page groups by CLASS and by OWNER over a
 * window, because its question is "what is wrong with this workspace, and whose
 * is it". One is a queue of live problems; the other is the shape they make.
 *
 * Suspense because the view is a client component that reads the window off the
 * URL — without a boundary the route deopts to fully dynamic.
 */
export default function Page() {
  return (
    <PageContainer>
      <React.Suspense fallback={<ControlSkeleton />}>
        <FailuresPage />
      </React.Suspense>
    </PageContainer>
  );
}
