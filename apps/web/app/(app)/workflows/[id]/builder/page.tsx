import { BuilderView } from "~/components/app/builder/builder-view";

export const metadata = { title: "Builder" };

/**
 * The builder (design §6.2, §7, §8).
 *
 * The id is passed through rather than resolved here. This used to call
 * `getWorkflow(id)` against the fixtures and `notFound()` on a miss, which meant
 * every real workflow — including one created thirty seconds earlier — opened as
 * a 404. The name is not known server-side any more, so the title is static and
 * the workflow's own name is drawn by the top bar once it loads.
 */
export default async function BuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BuilderView workflowId={id} />;
}
