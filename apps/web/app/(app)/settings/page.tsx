import * as React from "react";
import { SettingsView } from "~/components/app/admin/settings-view";
import { ControlSkeleton } from "~/components/app/control/skeletons";

export const metadata = { title: "Settings" };

/**
 * Sectioned rather than one long page (§10): General, Environments, Security,
 * Billing, Notifications and a Danger zone whose confirmations name exact
 * counts, per §12.
 */
export default function SettingsPage() {
  return (
    <React.Suspense fallback={<ControlSkeleton />}>
      <SettingsView />
    </React.Suspense>
  );
}
