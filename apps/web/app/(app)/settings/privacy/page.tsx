import { redirect } from "next/navigation";

export default async function SettingsPrivacyRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => next.append(key, entry));
    } else if (typeof value === "string") {
      next.set(key, value);
    }
  }
  redirect("/settings" as never);
}
