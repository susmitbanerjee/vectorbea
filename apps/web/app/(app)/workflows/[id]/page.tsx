import { notFound } from "next/navigation";
import { WorkflowOverview } from "~/components/app/workflows/overview";
import { getWorkflow } from "~/mocks/workflow-versions";

/**
 * A workflow lands on its OVERVIEW, not in the builder (design §10).
 *
 * Clicking a workflow is usually a diagnostic act — "is this thing working?" —
 * and dropping that question into an editing canvas puts a destructive surface
 * in front of it. The builder is one click away from here.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workflow = getWorkflow(id);
  return { title: workflow ? workflow.name : "Workflow" };
}

export default async function WorkflowOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workflow = getWorkflow(id);
  if (!workflow) notFound();

  return <WorkflowOverview workflow={workflow} />;
}
