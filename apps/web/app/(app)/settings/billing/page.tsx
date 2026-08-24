import * as React from "react";
import { PlanView } from "~/components/app/admin/plan-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Plan & access" };
export const dynamic = "force-dynamic";

/**
 * This redirected to /settings/usage with the note "billing is not implemented".
 * True, and it left the workspace with nowhere to see its access state or ask
 * for more. There is still no payment provider; what there is — beta access,
 * enforced limits, and a request queue — now has a page. See `plan-view.tsx`.
 */
export default function PlanPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <PlanView />
    </React.Suspense>
  );
}
