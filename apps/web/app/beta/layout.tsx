import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";
import { isEmailVerified } from "@/lib/auth/neon-auth";

export const dynamic = "force-dynamic";

// Private beta application — keep out of search indexes.
export const metadata = {
  robots: { index: false, follow: false },
};

/**
 * Gate for the beta application: must be signed in AND email-verified.
 * Unverified users go back to /verify-email; signed-out users to /signin.
 */
export default async function BetaLayout({ children }: { children: ReactNode }) {
  if (process.env.JWT_SECRET) {
    const user = await getAuthenticatedUserFromCookies(await cookies());
    if (!user) redirect("/signin?next=/beta");

    try {
      if (!(await isEmailVerified(user.id))) redirect("/verify-email");
    } catch (err) {
      if (err && typeof err === "object" && "digest" in err) throw err;
      // DB hiccup — let the page render rather than hard-failing
    }
  }
  return <>{children}</>;
}
