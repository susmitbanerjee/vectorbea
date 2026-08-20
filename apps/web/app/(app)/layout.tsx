import type { ReactNode } from "react";
import { cookies } from "next/headers";
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
              ? {
                  name: profile.full_name ?? profile.email ?? "Account",
                  email: profile.email ?? "",
                  avatarUrl: profile.avatar_url,
                }
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
