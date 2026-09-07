import * as React from "react";
import { TemplateGallery } from "~/components/app/templates/template-gallery";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Templates" };

/**
 * The template gallery.
 *
 * ── WHY THIS REPLACED THE FIXTURE VIEW ────────────────────────────────────
 * The previous view rendered `~/mocks/templates`: fabricated workflows with
 * fabricated integrations, whose "Use this template" produced nothing that
 * could run. Every card was an advertisement for a workflow that did not exist.
 *
 * The catalogue behind this one is six real orchestration patterns, each of
 * which INSTALLS — creating its agents, then the workflow, then the version
 * that makes it runnable — and each of which runs end to end in a clean
 * workspace once one model connection exists.
 *
 * Suspense is not stylistic: the gallery reads the workspace's connections and
 * entitlements to decide readiness, which opts the subtree into client
 * rendering. Without a boundary the whole route deopts to dynamic.
 */
export default function TemplatesPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <TemplateGallery />
    </React.Suspense>
  );
}
