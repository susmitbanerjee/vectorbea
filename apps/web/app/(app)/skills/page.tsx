import * as React from "react";
import { SkillsView } from "~/components/app/registry/skills-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Skills" };

/**
 * Skills — the library, what is installed, and what it needs.
 *
 * `SkillRoutes` has been complete since V073 — the library, install, versions,
 * holders and the per-agent grant with its refusal — and nothing in the product
 * rendered any of it. A feature whose only interface is a route handler is one
 * nobody uses.
 *
 * Suspense is required rather than stylistic: the view reads `useSearchParams`
 * for its URL-synced install dialog, which opts the subtree into client
 * rendering. Without a boundary the whole route deopts to dynamic.
 */
export default function SkillsPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <SkillsView />
    </React.Suspense>
  );
}
