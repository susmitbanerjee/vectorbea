import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import {
  getAuthenticatedUserFromCookies,
  getPostLoginRedirectForUser,
  loadProfileForUser,
} from "@/lib/auth/server";
import { WorkspaceProvider } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

// Auth is always required — JWT_SECRET controls it.
// If JWT_SECRET is not set the app degrades gracefully (shows UI without data).
const REQUIRE_AUTH = !!process.env.JWT_SECRET;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();

  if (REQUIRE_AUTH) {
    let user;
    try {
      user = await getAuthenticatedUserFromCookies(cookieStore);
    } catch {
      user = null;
    }

    if (!user) {
      redirect("/signin");
    }

    let organizations: { id: string; name: string }[] = [];
    let profile: { email: string | null; full_name: string | null; avatar_url: string | null } | null = null;

    try {
      const [orgData, profileData] = await Promise.all([
        getPostLoginRedirectForUser(user.id),
        loadProfileForUser(user.id),
      ]);
      organizations = orgData.organizations;
      profile = profileData;
    } catch {
      // DB call failed — degrade gracefully
    }

    return (
      <WorkspaceProvider organizations={organizations as never[]}>
        <div className="flex h-screen overflow-hidden" style={{ background: "#F8FAFC" }}>
          <AppSidebar summary={null} user={profile} />
          <main className="min-w-0 h-full flex-1 overflow-y-auto" style={{ background: "#F8FAFC" }}>{children}</main>
        </div>
      </WorkspaceProvider>
    );
  }

  // No JWT_SECRET — open/dev mode
  return (
    <WorkspaceProvider organizations={[] as never[]}>
      <div className="flex h-screen overflow-hidden" style={{ background: "#F8FAFC" }}>
        <AppSidebar summary={null} user={null} />
        <main className="min-w-0 h-full flex-1 overflow-y-auto" style={{ background: "#F8FAFC" }}>{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
