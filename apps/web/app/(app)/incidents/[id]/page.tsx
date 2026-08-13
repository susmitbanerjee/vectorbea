import * as React from "react";
import { IncidentDetail } from "~/components/app/incidents/incident-detail";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Incident" };

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <IncidentDetail incidentId={id} />
    </React.Suspense>
  );
}
