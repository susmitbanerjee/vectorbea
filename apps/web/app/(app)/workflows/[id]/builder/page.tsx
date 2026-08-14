import { notFound } from "next/navigation";
import { BuilderView } from "~/components/app/builder/builder-view";
import { getWorkflow } from "~/mocks/workflow-versions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workflow = getWorkflow(id);
  return { title: workflow ? `${workflow.name} — builder` : "Builder" };
}

/**
 * The builder (design §6.2, §7, §8).
 *
 * No Suspense boundary: BuilderView holds its state in a reducer rather than in
 * the URL, so it never reads useSearchParams and never opts the route into
 * client rendering on that account. It is a client component because a canvas
 * is, not because of a search param.
 */
export default async function BuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workflow = getWorkflow(id);
  if (!workflow) notFound();

  return <BuilderView workflow={workflow} />;
}
