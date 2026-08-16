import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { AuthScreen } from "~/components/app/auth/auth-screen";
import { getAuthenticatedUserFromCookies, getPostLoginRedirectForUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Create an account",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Don't redirect when an auth error is present — the user needs to see the
  // error message and try a different sign-in method.
  if (!error) {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);
    if (user) {
      try {
        const destination = next && next.startsWith("/") ? next : (await getPostLoginRedirectForUser(user.id)).redirectTo;
        redirect(destination as Route);
      } catch {
        redirect("/control");
      }
    }
  }

  return <AuthScreen mode="signup" next={next} error={error} />;
}
