import * as React from "react";
import { notFound } from "next/navigation";
import { PublishFlow } from "~/components/app/workflows/publish-flow";
import { getWorkflow } from "~/mocks/workflow-versions";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workflow = getWorkflow(id);
  return { title: workflow ? `Publish ${workflow.name}` : "Publish" };
}

/**
 * Draft → Validate → Simulate → Publish (design §10).
 *
 * A route rather than a modal: the flow holds a simulation result an operator
 * will want to read, argue about and come back to, and a dialog that loses it on
 * an accidental click outside is a dialog that makes people skip the step.
 *
 * Suspense is required, not stylistic: PublishFlow reads useSearchParams for its
 * URL-synced step, which opts the subtree into client rendering. Without a
 * boundary the whole route deopts to dynamic.
 */
export default async function PublishPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workflow = getWorkflow(id);
  if (!workflow) notFound();

  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <PublishFlow workflow={workflow} />
    </React.Suspense>
  );
}
