import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { isEmailVerified, markEmailVerified } from "@/lib/auth/neon-auth";
import { emailConfigured } from "@/lib/server/email";
import { VerifyEmailScreen } from "@/components/auth/verify-email-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify your email — Vectorbea", robots: { index: false, follow: false } };

/**
 * /verify-email — shown to signed-in users whose address isn't confirmed yet.
 * Once verified (via the mail link) they continue to the beta application.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const user = await getAuthenticatedUserFromCookies(await cookies());
  if (!user) redirect("/signin?next=/verify-email");

  try {
    if (await isEmailVerified(user.id)) redirect("/beta");

    // No email provider configured → the mail can never arrive. Don't trap
    // the user on this screen: heal the account and continue to /beta.
    if (!emailConfigured()) {
      console.warn(`[verify-email] no email provider configured — auto-verifying ${user.email}`);
      await markEmailVerified(user.id);
      redirect("/beta");
    }
  } catch (err) {
    // redirect() throws internally — re-throw those, swallow only DB errors
    if (err && typeof err === "object" && "digest" in err) throw err;
  }

  return <VerifyEmailScreen email={user.email} error={error} />;
}
