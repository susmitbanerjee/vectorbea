import { RoutePlaceholder } from "~/components/app/shell/placeholder";
import { QueueDepthIcon } from "~/components/icons/domain";

export const metadata = { title: "Triggers" };

/**
 * Triggers — Schedules, unified (design §9).
 *
 * A schedule is one KIND of trigger. Webhooks are listed as a feature in Usage
 * and run detail already reports `trigger: manual`, so two of the three trigger
 * types had no home at all. The legacy /schedules route stays live until this
 * replaces it.
 */
export default function TriggersPage() {
  return (
    <RoutePlaceholder
      eyebrow="Connect"
      title="Triggers"
      description="Schedules, webhooks and manual or API runs, in one place."
      icon={QueueDepthIcon}
      plannedIn="P19"
      bullets={[
        "Next fire time, timezone, jitter and overlap policy per trigger",
        "Webhook endpoints with secret rotation and delivery history",
        "Backfill: replay a schedule across a past window",
      ]}
    />
  );
}
