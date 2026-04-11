import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { apiFetch, type DashboardSummary, type OrganizationView } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [organizations, summary] = await Promise.all([
    apiFetch<OrganizationView[]>("/api/organizations").catch(() => [] as OrganizationView[]),
    apiFetch<DashboardSummary>("/api/dashboard/summary").catch(() => null),
  ]);

  // Gate the entire app behind onboarding — no organization, no dashboard.
  if (organizations.length === 0) {
    redirect("/onboarding");
  }

  return (
    <WorkspaceProvider organizations={organizations}>
      <div className="flex min-h-screen">
        <AppSidebar summary={summary} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
