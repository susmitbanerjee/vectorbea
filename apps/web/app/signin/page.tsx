import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { AuthScreen } from "~/components/app/auth/auth-screen";
import { resolveSignedInDestination } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

/**
 * THE SIGN-IN PAGE USED TO SHOW ITSELF TO SIGNED-IN USERS.
 *
 * `redirect()` works by throwing, and the redirect used to sit inside a
 * `try/catch` written to tolerate a missing JWT_SECRET — so the catch swallowed
 * the redirect and rendered the form to somebody who already had a session.
 * `resolveSignedInDestination` now owns everything that can throw and returns
 * the answer as a value; `redirect()` is called out here where nothing
 * intercepts it. See the note on that function.
 */
export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Not when an auth error is being reported: the user has to see what went
  // wrong and choose another method, and a stale cookie may still be present.
  const destination = error ? null : await resolveSignedInDestination(await cookies(), next);
  if (destination) redirect(destination as Route);

  return <AuthScreen mode="signin" next={next} error={error} />;
}
