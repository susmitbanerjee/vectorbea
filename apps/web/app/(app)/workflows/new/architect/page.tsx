import { ArchitectView } from "~/components/app/architect/architect-view";

export const metadata = { title: "AI Architect" };

/**
 * The Architect holds its whole session in one reducer and persists it, so the
 * flow survives a navigation — it reads no search params and needs no Suspense
 * boundary.
 */
export default function ArchitectPage() {
  return <ArchitectView />;
}
