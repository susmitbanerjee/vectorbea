import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { isSupportAdmin } from "@/lib/server/support";
import { SupportPortal } from "~/components/app/support/support-portal";
import { Text } from "~/components/ui/text";

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
      <div className="bg-surface-base flex min-h-screen items-center justify-center px-4">
        <div className="border-subtle bg-surface-raised shadow-2 w-full max-w-[26rem] rounded-lg border p-8 text-center">
          <Text variant="eyebrow" tone="muted" className="block">Support portal</Text>
          <Text variant="heading-md" tone="max" as="h1" className="mt-1 block">Support admins only</Text>
          <Text variant="body-sm" tone="secondary" className="mt-3 block">
            To get help, use the support button inside the app.
          </Text>
        </div>
      </div>
    );
  }

  return <SupportPortal adminEmail={user.email} initialTicket={ticket ?? null} />;
}
