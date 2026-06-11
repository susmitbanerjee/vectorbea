import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import AdminBetaApplicationsClient from "./client";

/**
 * Requires authentication only — the Kotlin API enforces admin access
 * via ADMIN_EMAILS / is_platform_admin on every API call.
 *
 * We intentionally do NOT redirect non-admins here because:
 * - ADMIN_EMAILS is set in Railway (Kotlin), not Vercel (Next.js)
 * - is_platform_admin DB check can fail if migration isn't applied
 * - The API already returns 403 for non-admins, which the client shows
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Beta Applications — Admin" };

export default async function AdminBetaApplicationsPage() {
  const cookieStore = await cookies();
  let user: { id: string; email: string } | null = null;
  try { user = await getAuthenticatedUserFromCookies(cookieStore); } catch {}

  if (!user) redirect("/signin");

  return <AdminBetaApplicationsClient />;
}
