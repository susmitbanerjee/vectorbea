// Redirect: /agent-runs/[id] → /runs/[id]
import { redirect } from "next/navigation";
import type { Route } from "next";

export default async function AgentRunDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/runs/${id}` as Route);
}
