import * as React from "react";
import { IncidentsView } from "~/components/app/incidents/incidents-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Incidents" };

export default function IncidentsPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <IncidentsView />
    </React.Suspense>
  );
}
