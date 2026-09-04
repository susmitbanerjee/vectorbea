import * as React from "react";
import { AuditView } from "~/components/app/admin/audit-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Audit log" };

/**
 * A new surface (§9). The docs promised a full audit trail and no screen
 * delivered it; enterprise buyers ask on the first call.
 */
export default function AuditLogPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <AuditView />
    </React.Suspense>
  );
}
