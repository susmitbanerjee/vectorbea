import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { AuthScreen } from "~/components/app/auth/auth-screen";
import { getAuthenticatedUserFromCookies, getPostLoginRedirectForUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  if (!error) {
    try {
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
    } catch {
      // JWT_SECRET not configured or token invalid — show sign-in form
    }
  }

  return <AuthScreen mode="signin" next={next} error={error} />;
}
