import { AuthScreen } from "@/components/auth/auth-screen";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sign in",
};

export default async function SigninPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthScreen mode="signin" next={next} />;
}
