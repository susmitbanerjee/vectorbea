import * as React from "react";
import { MembersView } from "~/components/app/admin/members-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Members" };

/**
 * Role has ONE source of truth here (§10). The previous version derived the
 * signed-in user's role separately from the table, which is how it managed to
 * show "Your role: Viewer" beside a row saying Owner.
 */
export default function MembersPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <MembersView />
    </React.Suspense>
  );
}
