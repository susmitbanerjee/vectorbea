import { cookies } from "next/headers";

import { DashboardOverview } from "@/components/dashboard/dashboard-overview";
import type { AuditLogView, DashboardSummary } from "@/lib/api";
import { getAuthenticatedUserFromCookies, loadOrganizationsForUser } from "@/lib/auth/server";
import {
  getDashboardSummaryForWorkspace,
  getRecentAuditLogsForWorkspace,
} from "@/lib/dal/dashboard";

type DashboardOverviewServerProps = {
  workspaceId: string | null;
};

export async function DashboardOverviewServer({
  workspaceId,
}: DashboardOverviewServerProps) {
  let auditLogs: AuditLogView[] = [];
  let dashboardSummary: DashboardSummary = {
    totalApiCallsLast24h: 0,
    auditsThisMonth: 0,
    averageLatencyMs: 0,
    activeAgents: 0,
  };

  if (workspaceId) {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);

    if (user) {
      const organizations = await loadOrganizationsForUser(user.id);
      const canAccessWorkspace = organizations.some((organization) =>
        organization.workspaces?.some((workspace) => workspace.id === workspaceId),
      );

      if (canAccessWorkspace) {
        auditLogs = await getRecentAuditLogsForWorkspace(workspaceId);
        dashboardSummary = await getDashboardSummaryForWorkspace(workspaceId, auditLogs);
      }
    }
  }

  return (
    <DashboardOverview
      workspaceId={workspaceId}
      initialAuditLogs={auditLogs}
      initialSummary={dashboardSummary}
    />
  );
}

function DashboardMetricSkeleton() {
  return <div className="h-44 animate-pulse rounded-2xl border border-border bg-muted/30" />;
}

export function DashboardOverviewFallback() {
  return (
    <div className="min-h-screen">
      <div className="space-y-3 border-b border-border/80 px-4 py-6 md:px-6 xl:px-8">
        <div className="h-10 w-44 animate-pulse rounded-xl bg-muted/40" />
        <div className="h-5 w-96 max-w-full animate-pulse rounded-lg bg-muted/30" />
      </div>

      <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DashboardMetricSkeleton />
          <DashboardMetricSkeleton />
          <DashboardMetricSkeleton />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <div className="h-[480px] animate-pulse rounded-2xl border border-border bg-muted/20" />
          <div className="h-[480px] animate-pulse rounded-2xl border border-border bg-muted/20" />
        </section>

        <section>
          <div className="h-[360px] animate-pulse rounded-2xl border border-border bg-muted/20" />
        </section>
      </div>
    </div>
  );
}
