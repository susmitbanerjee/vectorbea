import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { OAuthTokenTransfer } from "@/components/layout/OAuthTokenTransfer";
import {
  getAuthenticatedUserFromCookies,
  getPostLoginRedirectForUser,
  loadProfileForUser,
} from "@/lib/auth/server";
import { getUserBetaStatus } from "@/lib/auth/neon-auth";
import { WorkspaceProvider } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

// Auth is always required — JWT_SECRET controls it.
// If JWT_SECRET is not set the app degrades gracefully (shows UI without data).
const REQUIRE_AUTH = !!process.env.JWT_SECRET;

// Private beta mode — when true, unapproved users are redirected to /beta
const PRIVATE_BETA = process.env.NEXT_PUBLIC_PRIVATE_BETA_MODE === "true";

// Paths within the (app) group that waitlisted users may access
const BETA_OPEN_PATHS = ["/beta", "/settings/usage"];

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();

  if (REQUIRE_AUTH) {
    let user: { id: string; email: string } | null = null;
    try {
      user = await getAuthenticatedUserFromCookies(cookieStore);
    } catch {
      user = null;
    }

    if (!user) {
      redirect("/signin");
    }

    // ── Private beta gate ──────────────────────────────────────────────────
    if (PRIVATE_BETA) {
      let betaStatus = "approved"; // default safe for existing users pre-migration
      try {
        const bs = await getUserBetaStatus(user.id);
        betaStatus = bs?.betaStatus ?? "approved";
        // Platform admins always bypass the gate
        if (bs?.isPlatformAdmin) betaStatus = "approved";
      } catch {
        // Migration not yet applied — let them through
      }

      const isApproved = betaStatus === "approved";
      if (!isApproved) {
        // Allow access to beta application pages only
        const headersList = await headers();
        const pathname = headersList.get("x-pathname") ?? "";
        const allowedNow = BETA_OPEN_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"));
        if (!allowedNow) {
          redirect("/beta");
        }
      }
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
          <OAuthTokenTransfer />
          <AppSidebar summary={null} user={profile} />
          <main className="min-w-0 h-full flex-1 overflow-y-auto" style={{ background: "#F8FAFC" }}>{children}</main>
        </div>
      </WorkspaceProvider>
    );
  }

  // No JWT_SECRET — open/dev mode (all API calls will fail gracefully anyway)
  return (
    <WorkspaceProvider organizations={[] as never[]}>
      <div className="flex h-screen overflow-hidden" style={{ background: "#F8FAFC" }}>
        <AppSidebar summary={null} user={null} />
        <main className="min-w-0 h-full flex-1 overflow-y-auto" style={{ background: "#F8FAFC" }}>{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
