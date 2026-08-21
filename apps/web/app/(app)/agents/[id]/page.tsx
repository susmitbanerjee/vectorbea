import { redirect } from "next/navigation";

export default async function AgentDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/agents?agent=${encodeURIComponent(id)}`);
}
