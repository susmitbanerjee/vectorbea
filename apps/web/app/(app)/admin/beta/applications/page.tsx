import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { getUserBetaStatus } from "@/lib/auth/neon-auth";
import AdminBetaApplicationsClient from "./client";

/**
 * Server component — enforces admin gate before rendering anything.
 * Admin = isPlatformAdmin=true in DB OR email in ADMIN_EMAILS env var.
 * Non-admins are redirected to /dashboard rather than seeing an error shell.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Beta Applications — Admin" };

function isAdminEmail(email: string | null): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

export default async function AdminBetaApplicationsPage() {
  const cookieStore = await cookies();
  let user: { id: string; email: string } | null = null;
  try { user = await getAuthenticatedUserFromCookies(cookieStore); } catch {}

  if (!user) { redirect("/signin"); }

  // Check platform admin status in DB + ADMIN_EMAILS env var
  let isAdmin = isAdminEmail(user.email);
  if (!isAdmin) {
    try {
      const bs = await getUserBetaStatus(user.id);
      isAdmin = bs?.isPlatformAdmin === true;
    } catch {}
  }

  if (!isAdmin) {
    // Approved user but not admin — send to dashboard silently
    redirect("/dashboard");
  }

  return <AdminBetaApplicationsClient />;
}
