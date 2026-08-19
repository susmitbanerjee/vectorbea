import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

// AppShell replaces the presentational chrome only. Every auth, verification
// and beta gate below is untouched, as is the legacy AppSidebar component, which
// stays in the repo until the last screen is migrated (CLAUDE.md).
import { AppShell } from "~/components/app/shell/app-shell";
import { TelemetryPageViews } from "@/components/layout/telemetry-page-views";
import { SupportWidget } from "@/components/support/support-widget";
import { OAuthTokenTransfer } from "@/components/layout/OAuthTokenTransfer";
import {
  getAuthenticatedUserFromCookies,
  getPostLoginRedirectForUser,
  loadProfileForUser,
} from "@/lib/auth/server";
import { getUserBetaStatus } from "@/lib/auth/neon-auth";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { AppProviders } from "~/components/app/providers";
import { resolveWorkspacesForServer } from "~/lib/workspace/resolve-server";

export const dynamic = "force-dynamic";

// The entire authenticated application is private — keep every (app) route out
// of search indexes. Access is still enforced by auth below; this is defense in
// depth so nothing here can surface as a search result.
export const metadata = {
  robots: { index: false, follow: false },
};

// Auth is always required — JWT_SECRET controls it.
// If JWT_SECRET is not set the app degrades gracefully (shows UI without data).
const REQUIRE_AUTH = !!process.env.JWT_SECRET;

// Private beta mode — when active, unapproved users are redirected to /beta.
// Default ON: forgetting the env var must fail CLOSED (waitlisted users were
// landing in an empty app when this var was unset). Set to "false" to disable.
const PRIVATE_BETA = process.env.NEXT_PUBLIC_PRIVATE_BETA_MODE !== "false";

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

    // No email-verification gate. Sign-in is federated and every provider
    // hands us an address it has already verified, so there is nothing left to
    // confirm. Keeping the gate would strand every account created before
    // passwords were removed: `email_verified` is FALSE on those rows, and the
    // /verify-email route now redirects to /signin, which redirects a signed-in
    // user straight back here — an infinite loop.

    // ── Private beta gate ──────────────────────────────────────────────────
    if (PRIVATE_BETA) {
      // FAIL CLOSED: unknown status = waitlisted. Pre-existing users were
      // backfilled to 'approved' by V015, so they are unaffected.
      let betaStatus = "waitlisted";
      try {
        const bs = await getUserBetaStatus(user.id);
        betaStatus = bs?.betaStatus ?? "waitlisted";
        // Platform admins always bypass the gate
        if (bs?.isPlatformAdmin) betaStatus = "approved";
      } catch {
        // fall through with waitlisted
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

    const scope = await resolveWorkspacesForServer();

    return (
      <WorkspaceProvider organizations={organizations as never[]}>
        <OAuthTokenTransfer />
        <TelemetryPageViews />
        <SupportWidget />
        <AppProviders
          workspaces={scope.workspaces}
          defaultWorkspaceId={scope.defaultWorkspaceId}
        >
        <AppShell
          user={
            profile
              ? { name: profile.full_name ?? profile.email ?? "Account", email: profile.email ?? "" }
              : null
          }
        >
          {children}
        </AppShell>
        </AppProviders>
      </WorkspaceProvider>
    );
  }

  // No JWT_SECRET — open/dev mode. The API's own AuthMiddleware is disabled in
  // the same situation, so scoped calls still succeed on the workspace header.
  const scope = await resolveWorkspacesForServer();

  return (
    <WorkspaceProvider organizations={[] as never[]}>
      <AppProviders workspaces={scope.workspaces} defaultWorkspaceId={scope.defaultWorkspaceId}>
        <AppShell user={null}>{children}</AppShell>
      </AppProviders>
    </WorkspaceProvider>
  );
}
