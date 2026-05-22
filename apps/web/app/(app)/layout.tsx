import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import {
  getAuthenticatedUserFromCookies,
  getPostLoginRedirectForUser,
} from "@/lib/auth/server";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { WorkspaceProvider } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

// ─── Auth bypass flag ─────────────────────────────────────────────────────────
// When NEXT_PUBLIC_SUPABASE_URL is not configured the app runs in
// "open / mock-session mode": no login required, all API routes use the
// seeded acme-corp org. Set REQUIRE_AUTH=true in env vars to enforce login.
const SUPABASE_CONFIGURED =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_URL !== "https://your-project.supabase.co";

const REQUIRE_AUTH = process.env.REQUIRE_AUTH === "true" || SUPABASE_CONFIGURED;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();

  // ── Authenticated path ───────────────────────────────────────────────────
  if (REQUIRE_AUTH) {
    let user;
    try {
      user = await getAuthenticatedUserFromCookies(cookieStore);
    } catch {
      user = null;
    }

    if (!user) {
      redirect("/login");
    }

    let organizations: Awaited<ReturnType<typeof getPostLoginRedirectForUser>>["organizations"] = [];
    let profile: { email: string | null; full_name: string | null; avatar_url: string | null } | null = null;

    try {
      const [orgData, profileResult] = await Promise.all([
        getPostLoginRedirectForUser(user.id),
        createVectorBeaAdminClient()
          .from("profiles")
          .select("email, full_name, avatar_url")
          .eq("id", user.id)
          .single(),
      ]);
      const profileData = profileResult.data ?? null;

      organizations = orgData.organizations;
      profile = profileData;

      // Skip /onboarding redirect — the scheduler dashboard is the entry point.
      // Users without a Supabase org still land on the dashboard (mock session handles data).
    } catch {
      // Supabase call failed; degrade gracefully rather than crash
    }

    return (
      <WorkspaceProvider organizations={organizations}>
        <div className="flex h-screen overflow-hidden bg-background">
          <AppSidebar summary={null} user={profile} />
          <main className="page-surface min-w-0 h-full flex-1 overflow-y-auto">{children}</main>
        </div>
      </WorkspaceProvider>
    );
  }

  // ── Open / mock-session path (no Supabase configured) ────────────────────
  return (
    <WorkspaceProvider organizations={[]}>
      <div className="flex h-screen overflow-hidden bg-background">
        <AppSidebar summary={null} user={null} />
        <main className="page-surface min-w-0 h-full flex-1 overflow-y-auto">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
