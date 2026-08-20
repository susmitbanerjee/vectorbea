import { WorkflowDetail } from "~/components/app/workflows/workflow-detail";

export const metadata = { title: "Workflow" };

/**
 * A workflow lands on its OVERVIEW, not in the builder (design §10).
 *
 * Clicking a workflow is usually a diagnostic act — "is this thing working?" —
 * and dropping that question into an editing canvas puts a destructive surface
 * in front of it. The builder is one click away from here.
 *
 * The id is passed through rather than resolved server-side. This used to call
 * `getWorkflow(id)` against the fixtures and `notFound()` on a miss, so every
 * real workflow 404'd. The name is therefore not known until the client has
 * loaded it, which is why the title is static.
 */
export default async function WorkflowOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WorkflowDetail workflowId={id} />;
}
