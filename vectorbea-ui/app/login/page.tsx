import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth/auth-screen";
import { getAuthenticatedUserFromCookies, getPostLoginRedirectForUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Create an account",
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
        redirect(destination);
      } catch {
        redirect("/dashboard");
      }
    }
  }

  return <AuthScreen mode="signup" next={next} />;
}
