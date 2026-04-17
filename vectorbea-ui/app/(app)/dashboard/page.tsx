import { Suspense } from "react";

import {
  DashboardOverviewFallback,
  DashboardOverviewServer,
} from "@/components/dashboard/dashboard-overview-server";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; q?: string }>;
}) {
  const { org: workspaceId } = await searchParams;

  return (
    <Suspense fallback={<DashboardOverviewFallback />}>
      <DashboardOverviewServer workspaceId={workspaceId ?? null} />
    </Suspense>
  );
}
