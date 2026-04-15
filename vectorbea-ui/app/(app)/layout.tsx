import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { apiFetch, type DashboardSummary } from "@/lib/api";
import {
  getAuthenticatedUserFromCookies,
  getPostLoginRedirectForUser,
} from "@/lib/auth/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { WorkspaceProvider } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

  if (!user) {
    redirect("/login");
  }

  const [{ organizations, redirectTo }, summary, profile] = await Promise.all([
    getPostLoginRedirectForUser(user.id),
    apiFetch<DashboardSummary>("/api/dashboard/summary").catch(() => null),
    Promise.resolve(
      createVectorBeaAdminClient()
        .from("profiles")
        .select("email, full_name, avatar_url")
        .eq("id", user.id)
        .single(),
    ).then(({ data }) => data).catch(() => null),
  ]);

  if (redirectTo === "/onboarding" || redirectTo === "/settings/billing") {
    redirect(redirectTo);
  }

  return (
    <WorkspaceProvider organizations={organizations}>
      <div className="flex min-h-screen">
        <AppSidebar summary={summary} user={profile} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
