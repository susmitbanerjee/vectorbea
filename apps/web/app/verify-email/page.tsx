import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { isEmailVerified } from "@/lib/auth/neon-auth";
import { VerifyEmailScreen } from "@/components/auth/verify-email-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify your email — Vectorbea" };

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
  } catch (err) {
    // redirect() throws internally — re-throw those, swallow only DB errors
    if (err && typeof err === "object" && "digest" in err) throw err;
  }

  return <VerifyEmailScreen email={user.email} error={error} />;
}
