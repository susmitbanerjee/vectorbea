import { redirect } from "next/navigation";

export default async function ConnectionDetailRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const tab = query.tab === "settings" || query.tab === "credentials" ? "settings" : query.tab ?? "overview";
  redirect(`/connections?connection=${encodeURIComponent(id)}&tab=${encodeURIComponent(tab)}`);
}
