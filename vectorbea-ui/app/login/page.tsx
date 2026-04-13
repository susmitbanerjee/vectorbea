import { AuthScreen } from "@/components/auth/auth-screen";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Create an account",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthScreen mode="signup" next={next} />;
}
