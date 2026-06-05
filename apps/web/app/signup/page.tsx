import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { AuthScreen } from "@/components/auth/auth-screen";
import { getAuthenticatedUserFromCookies, getPostLoginRedirectForUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Create an account",
};

export default async function SignupPage({
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
          redirect("/dashboard");
        }
      }
    } catch {
      // JWT_SECRET not configured or token invalid — show sign-up form
    }
  }

  return <AuthScreen mode="signup" next={next} />;
}
