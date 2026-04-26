import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthScreen } from "@/components/auth/auth-screen";
import { getAuthenticatedUserFromCookies, getPostLoginRedirectForUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sign in",
};

export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  if (!error) {
    const cookieStore = await cookies();
    const user = await getAuthenticatedUserFromCookies(cookieStore);
    if (user) {
      try {
        const destination = next && next.startsWith("/") ? next : (await getPostLoginRedirectForUser(user.id)).redirectTo;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        redirect(destination as any);
      } catch {
        redirect("/dashboard");
      }
    }
  }

  return <AuthScreen mode="signin" next={next} />;
}
