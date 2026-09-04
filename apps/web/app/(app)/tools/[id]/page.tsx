import { redirect } from "next/navigation";

export default async function ToolDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/tools?tool=${encodeURIComponent(id)}`);
}
