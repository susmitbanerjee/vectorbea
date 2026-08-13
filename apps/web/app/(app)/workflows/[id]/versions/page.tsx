import * as React from "react";
import { notFound } from "next/navigation";
import { VersionHistory } from "~/components/app/workflows/version-history";
import { getWorkflow } from "~/mocks/workflow-versions";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workflow = getWorkflow(id);
  return { title: workflow ? `${workflow.name} — versions` : "Version history" };
}

/**
 * Suspense is required, not stylistic: VersionHistory reads useSearchParams for
 * the two versions being compared and the diff mode, which opts the subtree into
 * client rendering. Without a boundary the whole route deopts to dynamic.
 */
export default async function VersionHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workflow = getWorkflow(id);
  if (!workflow) notFound();

  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <VersionHistory workflow={workflow} />
    </React.Suspense>
  );
}
