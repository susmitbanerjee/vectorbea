import { TracesShell } from "@/components/traces/traces-shell";

export const dynamic = "force-dynamic";

export default async function TracesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;

  return <TracesShell initialQuery={q ?? ""} />;
}
