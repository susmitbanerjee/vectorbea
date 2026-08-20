import { NewWorkflowView } from "~/components/app/workflows/new-workflow-view";

export const metadata = { title: "New workflow" };

/**
 * New workflow (design §10).
 *
 * No Suspense boundary: NewWorkflowView holds everything in local state and
 * reads no search params, so it never opts the route into client rendering on
 * that account.
 */
export default function NewWorkflowPage() {
  return <NewWorkflowView />;
}
