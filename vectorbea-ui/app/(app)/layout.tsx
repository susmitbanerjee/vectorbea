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

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const user = await getAuthenticatedUserFromCookies(cookieStore);

  if (!user) {
    redirect("/login");
  }

  const [{ organizations, redirectTo }, profile] = await Promise.all([
    getPostLoginRedirectForUser(user.id),
    Promise.resolve(
      createVectorBeaAdminClient()
        .from("profiles")
        .select("email, full_name, avatar_url")
        .eq("id", user.id)
        .single(),
    ).then(({ data }) => data).catch(() => null),
  ]);

  if (redirectTo === "/onboarding") {
    redirect(redirectTo);
  }

  return (
    <WorkspaceProvider organizations={organizations}>
      {/* h-screen + overflow-hidden locks the root to the viewport.
          Sidebar and main each manage their own internal scroll so the
          sign-out button (mt-auto in the sidebar) is always visible at
          the bottom of the screen regardless of page content length. */}
      <div className="flex h-screen overflow-hidden">
        <AppSidebar summary={null} user={profile} />
        <main className="min-w-0 flex-1 h-full overflow-y-auto">{children}</main>
      </div>
    </WorkspaceProvider>
  );
}
