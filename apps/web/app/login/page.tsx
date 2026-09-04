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
 * `/login` is the legacy path, kept because old links and bookmarks still point
 * at it. It renders the SIGN-IN screen: it used to render `mode="signup"`, so
 * an existing user following an old link was asked to create an account.
 *
 * The redirect-swallowing bug documented on `resolveSignedInDestination` was
 * here too, in a slightly worse form — the inner `catch` called `redirect()`
 * again, so a workspace-lookup failure sent people to `/control` by throwing
 * through a handler that was about to swallow it anyway.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  const destination = error ? null : await resolveSignedInDestination(await cookies(), next);
  if (destination) redirect(destination as Route);

  return <AuthScreen mode="signin" next={next} error={error} />;
}
