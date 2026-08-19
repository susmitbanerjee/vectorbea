import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getAuthenticatedUserFromCookies } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// Private beta application — keep out of search indexes.
export const metadata = {
  robots: { index: false, follow: false },
};

/**
 * Gate for the beta application: must be signed in.
 *
 * The email-verification half is gone with password sign-in — federated
 * providers only hand us addresses they have already verified.
 */
export default async function BetaLayout({ children }: { children: ReactNode }) {
  if (process.env.JWT_SECRET) {
    const user = await getAuthenticatedUserFromCookies(await cookies());
    if (!user) redirect("/signin?next=/beta");
  }
  return <>{children}</>;
}
