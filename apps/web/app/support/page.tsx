import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { isSupportAdmin } from "@/lib/server/support";
import { SupportPortal } from "@/components/support/support-portal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support portal — Vectorbea", robots: { index: false, follow: false } };

/**
 * /support — in-app admin support portal. Only support admins
 * (SUPPORT_ADMIN_EMAILS) may enter. Notification emails deep-link here via
 * /support?ticket=VB-XXXXXX, which the portal auto-opens.
 */
export default async function SupportPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ ticket?: string }>;
}) {
  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) redirect("/signin?next=/support");

  const { ticket } = await searchParams;

  if (!isSupportAdmin(user.email)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F8F9] px-4">
        <div className="w-full max-w-[420px] rounded-[14px] border border-[#E0E3E6] bg-white p-8 text-center shadow-[0_12px_36px_rgba(11,13,15,0.06)]">
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#9CA3AF]">Support portal</p>
          <h1 className="mt-1 text-[20px] font-bold tracking-[-0.02em] text-[#0B0D0F]">Restricted area</h1>
          <p className="mt-3 text-[13.5px] leading-[1.7] text-[#6B7280]">
            This portal is only available to the Vectorbea support administrator.
            If you need help, use the support button inside the app instead.
          </p>
        </div>
      </div>
    );
  }

  return <SupportPortal adminEmail={user.email} initialTicket={ticket ?? null} />;
}
