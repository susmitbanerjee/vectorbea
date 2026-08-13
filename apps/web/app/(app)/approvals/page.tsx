import * as React from "react";
import { ApprovalsView } from "~/components/app/approvals/approvals-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <ApprovalsView />
    </React.Suspense>
  );
}
