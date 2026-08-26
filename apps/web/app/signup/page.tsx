import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { AuthScreen } from "~/components/app/auth/auth-screen";
import { resolveSignedInDestination } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Create an account",
  robots: { index: false, follow: false },
};

/**
 * Same fix as `/signin`: the redirect for an already-signed-in visitor used to
 * be swallowed by the surrounding `try/catch`, so a signed-in user who followed
 * a "Start free" link — the only call to action on the docs and marketing
 * pages — was shown the sign-up form instead of being sent into the app.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  const destination = error ? null : await resolveSignedInDestination(await cookies(), next);
  if (destination) redirect(destination as Route);

  return <AuthScreen mode="signup" next={next} error={error} />;
}
