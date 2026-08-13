import { RoutePlaceholder } from "~/components/app/shell/placeholder";
import { ByokKeyIcon } from "~/components/icons/domain";

export const metadata = { title: "Audit log" };

/**
 * Audit log — NEW in the revised IA (design §9).
 *
 * The docs promise "a full audit trail" under Governance and there is no screen
 * for it. Enterprise buyers ask for this on the first call.
 */
export default function AuditLogPage() {
  return (
    <RoutePlaceholder
      eyebrow="Govern"
      title="Audit log"
      description="Who did what, to which resource, and what changed."
      icon={ByokKeyIcon}
      plannedIn="P20"
      bullets={[
        "Actor, action, target and a diff of the change",
        "Filterable by member, resource type and time window",
        "Exportable, and retained independently of run history",
      ]}
    />
  );
}
